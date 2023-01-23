const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const database = require("./database");
const stripe = require("stripe");

require("dotenv").config();

const stripeAPI = stripe(process.env.STRIPE_SK);

const app = express();

app.use(express.static("./public"));

const encrypt = (userID) => {

    const salt = crypto.randomBytes(+process.env.SIGN_IN_SALT_SIZE).toString("base64");

    const key = crypto.scryptSync(process.env.SIGN_IN_AES_KEY, salt, 32);
    const iv = process.env.SIGN_IN_AES_IV;

    const cipher = crypto.createCipheriv(process.env.SIGN_IN_ENCRYPTION_ALGORITHM, key, Buffer.from(iv, "hex"));

    let token = cipher.update(userID, "base64", "base64");
    token += cipher.final("base64");

    return { salt, token, authTag : cipher.getAuthTag().toString("base64") };

}

const decrypt = (signIn) => {

    const salt = signIn.salt;
    const token = signIn.token;
    const authTag = signIn.authTag;

    const key = crypto.scryptSync(process.env.SIGN_IN_AES_KEY, salt, 32);
    const iv = process.env.SIGN_IN_AES_IV;

    const decipher = crypto.createDecipheriv(process.env.SIGN_IN_ENCRYPTION_ALGORITHM, key, Buffer.from(iv, "hex"));

    decipher.setAuthTag(Buffer.from(authTag, "base64"));

    let userID = decipher.update(token, "base64", "base64");
    userID += decipher.final("base64");

    return userID;

};

const getSignIn = (cookie) => {

    if (!cookie) {

        return undefined;

    }

    const cookies = cookie.split(";").map(x => x.split("="));

    let i = 0;
    while (i < cookies.length && cookies[i][0] != process.env.SIGN_IN_COOKIE_NAME) {

        i++;

    }

    if (cookies[i][0] != process.env.SIGN_IN_COOKIE_NAME) {

        return undefined;

    }

    return JSON.parse(decodeURIComponent(cookies[i][1]));

}

const checkIfSignedIn = async (cookie) => {

    const signIn = getSignIn(cookie);

    if (!signIn) {

        return false;

    }

    else {

        try {

            return await database.checkIfUserExists(null, null, decrypt(signIn));

        } catch (error) {

            return false;

        }

    }

};

app.post("/signup", async (req, res) => {

    const data = req.body;

    const username = data.username;
    const email = data.email;
    const password = data.password;

    if (!data || !username || !email || !password) {

        res.status(400).send("Mising sign up data.").end();

    }

    else {

        let userExists;

        try {

            userExists = await database.checkIfUserExists(username, email, null);

        } catch (error) {

            res.status(500).send(error).end();

            return;

        }
        
        if (userExists) {

            res.status(400).send("Username or email is already in use. This might be because your username is already taken.").end();

        }

        else {
        
            let userID;
    
            try {
    
                userID = await database.addNewUser(username, email, password);
    
            } catch (error) {
    
                res.status(500).send(error).end();
    
                return;
    
            }
    
            res.status(201).cookie(process.env.SIGN_IN_COOKIE_NAME, JSON.stringify(encrypt(userID)), { maxAge : 31557600000, httpOnly : true }).send("Signed Up Succesfully").end();
    
        }

    }

});

app.post("/signin", async (req, res) => {

    const data = req.body;

    const username = data.username;
    const password = data.password;

    if (!data || !username || !password) {

        res.status(400).send("Mising sign in data.").end();

    }

    else if (!(await database.checkIfUserExists(username, null))) {

        res.status(400).send("You haven't signed up yet, please sign up.").end();

    }

    else {

        let userID;

        try {

            userID = await database.getUserID(username, password);

        } catch (error) {

            res.status(500).send(error).end();

            return;

        }

        if (!userID) {

            res.status(403).send("Incorrect username or password.").end();

            return;

        }

        res.status(200).cookie(process.env.SIGN_IN_COOKIE_NAME, JSON.stringify(encrypt(userID)), { maxAge : 31557600000, httpOnly : true }).send("Signed In Succesfully").end();

    }

});

app.get("/checkIfSignedIn", async (req, res) => {

    res.status(200).json({ "loggedIn" : (await checkIfSignedIn(req.headers.cookie)).toString() }).end();

});

app.get("/checkIfPaidFor", async (req, res) => {

    let userID = getSignIn(req.headers.cookie);

    if (!userID) {

        res.status(401).send("Not signed in.").end();

    }

    else {

        const contentName = req.headers.contentName;

        if (!contentName) {

            res.status(400).send("No content name provided.").end();

        }

        else {

            const contentList = fs.readdirSync("./public/content");

            if (contentList.indexOf(contentName) == -1) {

                res.status(404).send("Content does not exist.").end();

            }

            else {

                userID = decrypt(userID);

                let paidFor;

                try {

                    paidFor = ((await database.getLessonList(contentName, userID)).length != 0).toString();

                } catch (error) {

                    res.status(500).send(error);

                    return;

                }

                res.status(200).json({ paidFor });

            }

        }

    }

});

app.get("/getContentList", async (req, res) => {

    let userID = getSignIn(req.headers.cookie);

    const data = req.headers;

    if (!userID && (data.filter == "true")) {

        res.status(401).send("You are not signed in, please sign in to see your paid for courses.").end();

    } 
    
    else {

        let contentList;
        let contentDescriptions;
        let contentTags;

        try {
      
            contentList = fs.readdirSync("./public/content");
            contentDescriptions = JSON.parse(fs.readFileSync("./content_descriptions.json"));
            contentTags = JSON.parse(fs.readFileSync("./content_tags.json"));

        } catch (error) {

            res.status(500).send(error);

            return

        }

        if (data.filter == "true") {
            
            userID = decrypt(userID);

            const filteredCotentList = [];

            for (let i = 0; i < contentList.length; i++) {

                try {

                    if ((await database.getLessonList(contentName, userID)).length != 0) {

                        filteredCotentList.push(contentList[i])

                    }

                } catch (error) {

                    res.status(500).send(error).end();

                    return;

                }

            }

            res.status(200).json({ contentList : filteredCotentList, contentDescriptions, contentTags }).end();
            
        }

        else {

            const codeFiles = ["info.css", "info.js"];

            res.status(200).json({ contentList : contentList.filter(elem => codeFiles.indexOf(elem) == -1), contentDescriptions, contentTags }).end();

        }

    }

});

app.get("/getLessonList", async (req, res) => {

    let userID = getSignIn(req.headers.cookie);

    if (!userID) {

        res.status(401).send("Not signed in.").end();

    }

    else {

        const contentName = req.headers.contentname;
        
        if (!contentName) {

            res.status(400).send("No content name provided.").end();

        }

        else {

            const contentList = fs.readdirSync("./public/content");

            if (contentList.indexOf(contentName) == -1) {

                res.status(404).send("Content does not exist.").end();

            }

            else {

                userID = decrypt(userID);

                res.status(200).json({ lessonList : await database.getLessonList(contentName, userID) })

            }

        }

    }

});

app.get("/video", async (req, res) => {

    const signInToken = getSignIn(req.headers.cookie);

    if (!signInToken) {

        res.status(401).send("You are not signed in, please sign in to access content.").end();

    }

    else {

        const lessonNumber = req.query.index;
        
        let lessonPaidFor;

        try {

            lessonPaidFor = await database.getLessonList(req.query.requestedContent, signInToken)[lessonNumber];
    
        } catch (error) {
    
            res.status(500).send(error).end();

            return;
    
        }

        if (!lessonPaidFor) {

            res.send(401).send("You have not paid for this content.").end();

            return;
            
        }

        let range = req.headers.range;

        if (!range) {

            res.status(400).send("No range provided.").end();

        }

        else {
        
            const filePath = "./videos/" + req.query.name + req.query.index + ".mp4";

            if (!fs.existsSync(filePath)) {

                res.status(404).send("Can't find video.").end();

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

        res.status(401).send("Incorrect Password.").end();

    }

    else {

        const contentName = req.query.name;
        const lessonIndex = req.query.i;

        if (!contentName || !lessonIndex) {

            res.send(400).send("Missing lesson data.").end();

        }

        else {

            const priceIDS = JSON.parse(fs.readFileSync("price_ids.json"));

            if (!priceIDS[contentName]) {

                res.status(404).send("Content does not exist.").end();

            }

            else {

                if (!priceIDS[contentName][lessonIndex]) {

                    res.status(404).send("Lesson does not exists.").end();

                }

                else {

                    try {

                        const session = await stripeAPI.checkout.sessions.create({

                            payment_intent_data : {

                                metadata : {

                                    contentName,
                                    lessonIndex
    
                                }

                            },

                            customer : customerID,
                            
                            success_url : process.env.DOMAIN_NAME + `/content/${encodeURIComponent(contentName)}/content.html`,
                            cancel_url : process.env.DOMAIN_NAME + `/content/${encodeURIComponent(contentName)}/info.html`,
                            
                            currency : "aud",
                            mode : "payment",
                            payment_method_types : ["card"],
                            
                            line_items : [ { price : priceIDS[contentName][1], quantity : 1 } ]
            
                        });
            
                        res.status(200).json({ URL : session.url }).end();

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

        res.status(400).send(error).end();

        return;

    }

    

    res.status(200).end();

});

app.listen(80, () => { 
    
    database.init(); 
    console.log("listening"); 

});