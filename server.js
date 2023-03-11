const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const database = require("./database");
const stripe = require("stripe");

require("dotenv").config();

const stripeAPI = stripe(process.env.STRIPE_SK);

const app = express();

app.use(express.static("./public"));

let courseData = {};
let priceIDS = {};

const encrypt = (content, encoding) => {

    const encryptionSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");

    const key = crypto.scryptSync(process.env.SIGN_IN_AES_KEY, encryptionSalt, 32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(process.env.DATABASE_ENCRYPTION_ALGORITHM, key, iv);

    const output = cipher.update(content, encoding, "base64") + cipher.final("base64");

    return { content : output, encryptionSalt, iv : iv.toString("base64"), authTag : cipher.getAuthTag().toString("base64") };

};

const decrypt = (encryptionData, encoding) => {

    const key = crypto.scryptSync(process.env.DATABASE_AES_KEY, encryptionData.encryptionSalt, 32);

    const decipher = crypto.createDecipheriv(process.env.DATABASE_ENCRYPTION_ALGORITHM, Buffer.from(key, "base64"), Buffer.from(encryptionData.iv, "base64"));
    
    decipher.setAuthTag(Buffer.from(encryptionData.authTag, "base64"));

    const output = decipher.update(encryptionData.content, "base64", encoding) + decipher.final(encoding);

    return output;

};

const generateToken = (username, userID) => {

    return JSON.stringify({

        username : encrypt(username, "utf-8"),
        userID : encrypt(userID, "base64")

    });

}

const getToken = (cookie) => {

    if (!cookie) {

        return undefined;

    }

    const cookies = cookie.split(";").map(x => x.split("="));

    if (cookies.length === 0) {

        return undefined;

    }

    let i = 0;
    while (i < cookies.length && cookies[i][0] !== process.env.SIGN_IN_COOKIE_NAME) {

        i++;

    }

    if (cookies[i][0] !== process.env.SIGN_IN_COOKIE_NAME) {

        return undefined;

    }

    return JSON.parse(decodeURIComponent(cookies[i][1]));

}

const checkIfSignedIn = async (cookie) => {

    const signIn = getToken(cookie);

    if (!signIn) {

        return false;

    }

    else {

        try {

            return await database.verifyUserID(decrypt(signIn.username), decrypt(signIn.userID));

        } catch (error) {

            return false;

        }

    }

};

app.post("/signup", express.json(), async (req, res) => {

    const data = req.body;

    if (!data) {

        res.status(400).send("Missing requeust data.");

        return;

    }

    const username = data.username;
    const email = data.email;
    const password = data.password;

    if (!username || !email || !password) {

        res.status(400).send("Mising sign up data.");

        return;

    }
        
    let userID;
    
    try {
    
        userID = await database.addNewUser(username, email, password);
    
    } catch (error) {

        console.log(error);
    
        res.status(500).send(error);
    
        return;
    
    }
    
    res.status(201).cookie(process.env.SIGN_IN_COOKIE_NAME, generateToken(username, userID), { maxAge : 31557600000, httpOnly : true }).send("Signed Up Succesfully");

});

app.post("/signin", express.json(), async (req, res) => {

    const data = req.body;

    if (!data) {

        res.status(400).send("Missing request data.");

        return;

    }

    const username = data.username;
    const password = data.password;

    if (!username || !password) {

        res.status(400).send("Mising sign in data.");

    }

    else {

        let userID;

        try {

            userID = await database.getUserID(username, password);

        } catch (error) {

            res.status(500).send(error);

            return;

        }

        if (!userID) {

            res.status(403).send("Incorrect username or password.");

            return;

        }

        res.status(200).cookie(process.env.SIGN_IN_COOKIE_NAME, generateToken(username, userID), { maxAge : 31557600000, httpOnly : true }).send("Signed In Succesfully");

    }

});

app.get("/checkIfSignedIn", express.json(), async (req, res) => {

    res.status(200).json({ "loggedIn" : (await checkIfSignedIn(req.headers.cookie)).toString() });

});

app.get("/checkIfPaidFor", express.json(), async (req, res) => {

    let userID = getToken(req.headers.cookie).uesrID;

    if (!userID) {

        res.status(401).send("Not signed in.");

    }

    else {

        const courseName = req.headers.courseName;

        if (!courseName) {

            res.status(400).send("No course name provided.");

        }

        else {

            const courseList = Object.keys(courseData);

            if (courseList.indexOf(courseName) === -1) {

                res.status(404).send("Content does not exist.");

            }

            else {

                userID = decrypt(userID);

                let paidFor;

                try {

                    paidFor = (await database.checkIfPaidFor(courseName, userID)).toString();

                } catch (error) {

                    res.status(500).send(error);

                    return;

                }

                res.status(200).json({ paidFor });

            }

        }

    }

});

app.get("/getContentList", express.json(), async (req, res) => {

    let userID = getToken(req.headers.cookie).userID;

    const data = req.headers;

    if (!userID && (data.filter === "true")) {

        res.status(401).send("You are not signed in, please sign in to see your paid for courses.");

    } 
    
    else {

        let courseList;
        let courseDescriptions;
        let courseTags;

        try {
      
            courseList = fs.readdirSync("./public/course");
            courseDescriptions = JSON.parse(fs.readFileSync("./course_descriptions.json"));
            courseTags = JSON.parse(fs.readFileSync("./course_tags.json"));

        } catch (error) {

            res.status(500).send(error);

            return

        }

        if (data.filter === "true") {
            
            userID = decrypt(userID);

            const filteredCotentList = [];

            for (let i = 0; i < courseList.length; i++) {

                try {

                    if ((await database.getLessonList(courseName, userID)).length !== 0) {

                        filteredCotentList.push(courseList[i])

                    }

                } catch (error) {

                    res.status(500).send(error);

                    return;

                }

            }

            res.status(200).json({ courseList : filteredCotentList, courseDescriptions, courseTags });
            
        }

        else {

            const codeFiles = ["info.css", "info.js"];

            res.status(200).json({ courseList : courseList.filter(elem => codeFiles.indexOf(elem) === -1), courseDescriptions, courseTags });

        }

    }

});

app.get("/getLessonList", express.json(), async (req, res) => {

    let userID = getToken(req.headers.cookie);

    if (!userID) {

        res.status(401).send("Not signed in.");

    }

    else {

        const courseName = req.headers.coursename;
        
        if (!courseName) {

            res.status(400).send("No course name provided.");

        }

        else {

            const courseList = fs.readdirSync("./public/course");

            if (courseList.indexOf(courseName) === -1) {

                res.status(404).send("Content does not exist.");

            }

            else {

                userID = decrypt(userID);

                res.status(200).json({ lessonList : await database.getLessonList(courseName, userID) })

            }

        }

    }

});

app.get("/video", express.json(), async (req, res) => {

    const signInToken = getToken(req.headers.cookie);

    if (!signInToken) {

        res.status(401).send("You are not signed in, please sign in to access course.");

    }

    else {

        const lessonNumber = req.query.index;
        
        let lessonPaidFor;

        try {

            lessonPaidFor = await database.getLessonList(req.query.requestedContent, signInToken)[lessonNumber];
    
        } catch (error) {
    
            res.status(500).send(error);

            return;
    
        }

        if (!lessonPaidFor) {

            res.send(401).send("You have not paid for this course.");

            return;
            
        }

        let range = req.headers.range;

        if (!range) {

            res.status(400).send("No range provided.");

        }

        else {
        
            const filePath = "./videos/" + req.query.name + req.query.index + ".mp4";

            if (!fs.existsSync(filePath)) {

                res.status(404).send("Can't find video.");

            }

            else {

                range = range.substring(6).split("-");

               const videoSize = fs.statSync(filePath).size;

                const chunkLength = 2 ** 20;

                const start = Math.min(Number(range[0]), videoSize - 1);

                if (!range[1]) {

                    range[1] = start + chunkLength;

                }

                const end = Math.min(Number(range[1]), videoSize - 1);

                const contentLength = end - start + 1;

                const headers = {

                    "Content-Range": `bytes ${start}-${end}/${videoSize}`,
                    "Accept-Ranges": "bytes",
                    "Content-Length": contentLength,
                    "Content-Type": "video/mp4"

                };

                res.writeHead(206, headers);

                const videoStream = fs.createReadStream(filePath, { start, end });

                videoStream.pipe(res);

            }

        }

    }

});

app.post("/buyContent", express.json(), async (req, res) => {

    const username = req.body.username;
    const password = req.body.password;

    let customerID;

    try {

        customerID = await database.getCustomerID(username, password);

    } catch (error) {

        console.log(error);

        res.status(500).send(error);

        return;

    }

    if (!customerID) {

        res.status(401).send("Incorrect Password.");

    }

    else {

        const courseName = req.query.name;
        const lessonIndex = req.query.i;

        if (!courseName || !lessonIndex) {

            res.send(400).send("Missing lesson data.");

        }

        else {

            if (!priceIDS[courseName]) {

                res.status(404).send("Content does not exist.");

            }

            else {

                if (!priceIDS[courseName][lessonIndex]) {

                    res.status(404).send("Lesson does not exists.");

                }

                else {

                    try {

                        const session = await stripeAPI.checkout.sessions.create({

                            payment_intent_data : {

                                metadata : {

                                    courseName,
                                    lessonIndex
    
                                }

                            },

                            customer : customerID,
                            
                            success_url : process.env.DOMAIN_NAME + `/course/${encodeURIComponent(courseName)}/content.html`,
                            cancel_url : process.env.DOMAIN_NAME + `/course/${encodeURIComponent(courseName)}/info.html`,
                            
                            currency : "aud",
                            mode : "payment",
                            payment_method_types : ["card"],
                            
                            line_items : [ { price : priceIDS[courseName][1], quantity : 1 } ]
            
                        });
            
                        res.status(200).json({ URL : session.url });

                    } catch (error) {

                        res.status(500).send(error);


                    }

                }

            }

        }

    }

});

app.post("/webhook", express.raw({type: 'application/json'}), async (req, res) => {

    let event = req.body;

    const sig = req.headers["stripe-signature"];

    try {

        event = stripe.webhooks.constructEvent(event, sig, process.env.STRIPE_WEBHOOK_SIGNING);

    } catch (error) {

        res.status(400).send(error);

        return;

    }

    res.status(200).send();

});

app.listen(process.env.PORT || 3000, async () => {

    console.log("task 1/2 : initializing database");
    
    await database.init();
    
    console.log("task 1/2 : database initialized");

    console.log("task 2/2 : loading course data");

    courseData = JSON.parse(fs.readFileSync("course_data.json"));

    console.log("task 2/2 : course data loaded");

    console.log("tasks complete, listening on port " + process.env.PORT || 3000);

});