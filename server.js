const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const database = require("./database");
const stripe = require("stripe");
const { URLSearchParams } = require("url");
const morgan = require("morgan");
require("dotenv").config();

let courseData = {};
let courseList = [];
let courseDescriptions;
let courseTags;

const filterChildProperties = (obj, property) => {

    const keys = Object.keys(obj);

    const toReturn = {};

    for (let i = 0; i < keys.length; i++) {

        toReturn[keys[i]] = obj[keys[i]][property];

    }

    return toReturn;

}

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

    try {

        return decipher.update(encryptionData.content, "base64", encoding) + decipher.final(encoding);

    } catch (error) {

        return "";

    }

};

const wait = (ms) => {

    return new Promise((resolve) => { setTimeout(() => { resolve(); }, ms);} );

}

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

    const cookies = new URLSearchParams(cookie);

    const rawToken = cookies.get(process.env.SIGN_IN_COOKIE_NAME);

    if (!rawToken) {

        return undefined;

    }

    else {

        const token = JSON.parse(decodeURIComponent(token));

        if (!token.username || ! token.userID || Object.keys(token.username).length != 4 || Object.keys(token.userID) != 4) {

            return null;

        }

        else {

            return {

                username : decrypt(token.username),
                userID : decrypt(token.userID)

            };

        }

    }

}

const checkIfSignedIn = async (cookie) => {

    const token = getToken(cookie);

    if (!token) {

        return false;

    }

    else {

        const username = decrypt(token.username);
        const userID = decrypt(token.userID);

        try {

            return await database.verifyUserID(username, userID);

        } catch (error) {

            return false;

        }

    }

};

morgan.token("client-ip", (req) => {

    const header = req.headers["x-forwarded-for"];

    if (header) {

      return header;
    
    }
    return req.ip == "::1" ? "127.0.0.1" : req.ip;
    
})

const stripeAPI = stripe(process.env.STRIPE_SK);

const app = express();

app.use(morgan(":date - :client-ip - :user-agent - :url"));
app.use(express.static("public"));

app.post("/signup", express.json(), async (req, res) => {
    
    await wait(crypto.randomInt(+process.env.MAX_DELAY_LENGTH));

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
    
        res.status(500).send(error);
    
        return;
    
    }
    
    res.status(201).cookie(process.env.SIGN_IN_COOKIE_NAME, generateToken(username, userID), { maxAge : 31557600000, httpOnly : true }).send("Signed Up Succesfully");

});

app.post("/signin", express.json(), async (req, res) => {

    await wait(crypto.randomInt(+process.env.MAX_DELAY_LENGTH));

    const data = req.body;

    if (!data) {

        res.status(400).send("Missing request data.");

        return;

    }

    const username = data.username;
    const password = data.password;

    if (!data || !username || !password) {

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

    await wait(crypto.randomInt(+process.env.MAX_DELAY_LENGTH));

    res.status(200).json({ "loggedIn" : (await checkIfSignedIn(req.headers.cookie)).toString() });

});

app.get("/checkIfPaidFor", express.json(), async (req, res) => {

    await wait(crypto.randomInt(+process.env.MAX_DELAY_LENGTH));

    const token = getToken(req.headers.cookie);

    if (!token) {

        res.status(401).send("Not signed in.");

    }

    else {

        const username = decrypt(token.username);
        const userID = decrypt(token.userID);

        if (!username || !userID) {

            res.status(401).send("Not signed in.");

            return;

        }

        const courseName = req.headers.courseName;

        if (!courseName) {

            res.status(400).send("No course name provided.");

        }

        else {

            if (courseList.indexOf(courseName) == -1) {

                res.status(404).send("Content does not exist.");

            }

            else {

                try {

                    paidFor = (await database.checkIfPaidFor(courseName, username, userID)).toString();

                } catch (error) {

                    res.status(500).send(error);

                    return;

                }

                res.status(200).json({ paidFor });

            }

        }

    }

});

app.get("/getCourseData", express.json(), async (req, res) => {

    await wait(crypto.randomInt(+process.env.MAX_DELAY_LENGTH));

    const data = req.headers;

    const token = getToken(req.headers.cookie);

    if (!token && (data.filter == "true")) {

        res.status(401).send("You are not signed in, please sign in to see your paid for courses.");

    } 
    
    else {

        if (data.filter == "true") {

            const username = token.username;
            const userID = token.userID;

            const filteredCourseList = [];

            for (let i = 0; i < courseList.length; i++) {

                try {

                    if ((await database.checkIfPaidFor(courseList[i], username, userID))) {

                        filteredCourseList.push(courseList[i])

                    }

                } catch (error) {

                    res.status(500).send(error);

                    return;

                }

            }

            res.status(200).json({ courseList : filteredCourseList, courseDescriptions, courseTags });
            
        }

        else {

            res.status(200).json({ courseList, courseDescriptions, courseTags });

        }

    }

});

app.get("/video", express.json(), async (req, res) => {

    await wait(crypto.randomInt(+process.env.MAX_DELAY_LENGTH));

    const token = getToken(req.headers.cookie);

    if (!token) {

        res.status(401).send("You are not signed in, please sign in to access your course.");

    }

    else {

        const username = decrypt(token.username);
        const userID = decrypt(token.userID);

        if (!username || !userID) {

            res.status(401).send("You are not signed in, please sign in to access your course.");

            return;

        }

        if (!req.query.courseName) {

            res.status(400).send("Missing course name.");

            return;

        }
        
        let lessonPaidFor;

        try {

            lessonPaidFor = await database.checkIfPaidFor(req.query.courseName, username, userID);
    
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

    await wait(crypto.randomInt(+process.env.MAX_DELAY_LENGTH));

    const username = req.body.username;
    const password = req.body.password;

    let customerID;

    try {

        customerID = await database.getCustomerID(username, password);

    } catch (error) {

        res.status(500).send(error);

        return;

    }

    if (!customerID) {

        res.status(401).send("Incorrect Password.");

    }

    else {

        const courseName = req.query.name;

        if (!courseName || !lessonIndex) {

            res.send(400).send("Missing lesson data.");

        }

        else {

            if (courseList.indexOf(courseName) == -1) {

                res.status(404).send("Content does not exist.");

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
                            
                        line_items : [ { price : courseData[courseName].stripe_price_id, quantity : 1 } ]
            
                    });
            
                    res.status(200).json({ URL : session.url });

                } catch (error) {

                    res.status(500).send(error);


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

app.listen(process.env.PORT || 3000, async() => {

    console.log("task 1/2 : initializing database");
    
    await database.init();
    
    console.log("task 1/2 : database initialization successful");

    console.log("task 2/2 : loading course data");

    courseData = JSON.parse(fs.readFileSync("course_data.json"));
    courseList = Object.keys(courseData);
    courseDescriptions = filterChildProperties(courseData, "description");
    courseTags = filterChildProperties(courseData, "tags");

    console.log("task 2/2 : course data loaded");

    console.log("tasks complete, listening on port " + process.env.PORT || 3000);

});