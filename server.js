const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const database = require("./database");
const express = require("express");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");
const ms = require("ms");
const stripe = require("stripe");
const path = require("path");
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

};

const passwordHash = (password, salt, size) => {

    return crypto.scryptSync(password, salt, size);

};

const encrypt = (content, encoding) => {

    const encryptionSalt = crypto.randomBytes(Number(process.env.SALT_SIZE)).toString("base64");

    const key = passwordHash(process.env.AES_KEY, encryptionSalt, 32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(process.env.ENCRYPTION_ALGORITHM, key, iv);

    const output = cipher.update(content, encoding, "base64") + cipher.final("base64");

    return { content: output, encryptionSalt, iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };

};

const decrypt = (encryptionData, encoding) => {

    const key = passwordHash(process.env.AES_KEY, encryptionData.encryptionSalt, 32);

    const decipher = crypto.createDecipheriv(process.env.ENCRYPTION_ALGORITHM, Buffer.from(key, "base64"), Buffer.from(encryptionData.iv, "base64"));

    decipher.setAuthTag(Buffer.from(encryptionData.authTag, "base64"));

    const output = decipher.update(encryptionData.content, "base64", encoding) + decipher.final(encoding);

    return output;

};

const wait = (t) => {

    return new Promise((resolve) => { setTimeout(() => { resolve(); }, t); });

};

const generateToken = async (username, userID) => {

    const jwtID = crypto.randomBytes(Number(process.env.JWT_ID_SIZE)).toString("base64");

    await database.saveJWTId(username, jwtID);

    return jwt.sign({ username: encrypt(username, "utf-8"), userID: encrypt(userID, "base64"), jwtID: encrypt(jwtID, "base64") }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES });

};

const getToken = async (token) => {

    try {

        const encryptedToken = jwt.verify(token, process.env.JWT_SECRET);

        const decryptedToken = { username: decrypt(encryptedToken.username, "utf-8"), userID: decrypt(encryptedToken.userID, "base64") }

        if (!(await database.verifyUserID(decryptedToken.username, decryptedToken.userID))) {

            return null;

        }

        if (!(await database.verifyJWTId(decryptedToken.username, decrypt(encryptedToken.jwtID, "base64")))) {

            return null;

        }

        return decryptedToken;

    }

    catch (error) {

        return null;

    }

};

const getTokenMiddleware = async (req, res, next) => {

    const token = req.cookies.jwt ? (await getToken(req.cookies.jwt)) : null;

    req.headers.auth = token;

    next();

};

morgan.token("client-ip", (req) => {

    const header = req.headers["x-forwarded-for"];

    if (header) {

        return header;

    }

    return req.ip == "::1" ? "127.0.0.1" : req.ip;

});

const stripeAPI = stripe(process.env.STRIPE_SK);

const app = express();

app.use(morgan(":date - :client-ip - :user-agent - :url"));
app.use(cookieParser());
app.use(getTokenMiddleware);

app.use(express.static("assets"));

app.get("/", (req, res) => {

    res.status(200).sendFile(path.join(__dirname, "public/index.html"));

});

app.get("/learn", (req, res) => {

    res.status(200).sendFile(path.join(__dirname, "public/learn.html"));

});

app.get("/account", (req, res) => {

    res.status(200).sendFile(path.join(__dirname, "public/account.html"));

});

app.get("/signin", (req, res) => {

    res.status(200).sendFile(path.join(__dirname, "public/signin.html"));

});

app.get("/signup", (req, res) => {

    res.status(200).sendFile(path.join(__dirname, "public/signup.html"));

});

app.post("/signup", express.json(), async (req, res) => {

    await wait(crypto.randomInt(Number(process.env.MAX_DELAY_LENGTH)));

    if (req.headers.auth) {

        res.status(409).send("You are already signed in.");

        return;

    }

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

        res.status(500).send(error.toString());

        return;

    }

    try {

        res.status(201).cookie("jwt", await generateToken(username, userID), { httpOnly: true, maxAge: ms(process.env.JWT_EXPIRES) }).send("Signed Up Succesfully");

    }

    catch (error) {

        res.status(500).send(error.toString());

    }

});

app.post("/signin", express.json(), async (req, res) => {

    if (req.headers.auth) {

        res.status(409).send("You are already signed in.");

        return;

    }

    await wait(crypto.randomInt(Number(process.env.MAX_DELAY_LENGTH)));

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

            res.status(500).send(error.toString());

            return;

        }

        if (!userID) {

            res.status(403).send("Incorrect username or password.");

            return;

        }

        try {

            res.status(200).cookie("jwt", await generateToken(username, userID), { httpOnly: true, maxAge: ms(process.env.JWT_EXPIRES) }).send("Signed In Succesfully");

        }

        catch (error) {

            res.status(500).send(error.toString());

        }

    }

});

app.get("/checkIfSignedIn", express.json(), async (req, res) => {

    await wait(crypto.randomInt(Number(process.env.MAX_DELAY_LENGTH)));

    res.status(200).json({ "loggedIn": !!req.headers.auth });

});

app.get("/checkIfPaidFor", express.json(), async (req, res) => {

    await wait(crypto.randomInt(Number(process.env.MAX_DELAY_LENGTH)));

    const token = req.headers.auth;

    if (!token) {

        res.status(401).send("Not signed in.");

    }

    else {

        const username = token.username;
        const userID = token.userID;

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

                    res.status(500).send(error.toString());

                    return;

                }

                res.status(200).json({ paidFor });

            }

        }

    }

});

app.get("/getCourseData", express.json(), async (req, res) => {

    await wait(crypto.randomInt(Number(process.env.MAX_DELAY_LENGTH)));

    const data = req.headers;

    const token = req.headers.auth;

    if (!token && data.filter == "true") {

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

                    res.status(500).send(error.toString());

                    return;

                }

            }

            console.log(filteredCourseList);

            res.status(200).json({ courseList: filteredCourseList, courseDescriptions, courseTags });

        }

        else {

            res.status(200).json({ courseList, courseDescriptions, courseTags });

        }

    }

});

app.get("/video", express.json(), async (req, res) => {

    await wait(crypto.randomInt(Number(process.env.MAX_DELAY_LENGTH)));

    const token = req.headers.auth;

    if (!token) {

        res.status(401).send("You are not signed in, please sign in to access your course.");

    }

    else {

        const username = token.username;
        const userID = token.userID;

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

            res.status(500).send(error.toString());

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

    await wait(crypto.randomInt(Number(process.env.MAX_DELAY_LENGTH)));

    const username = req.body.username;
    const password = req.body.password;

    let customerID;

    try {

        customerID = await database.getCustomerID(username, password);

    } catch (error) {

        res.status(500).send(error.toString());

        return;

    }

    if (!customerID) {

        res.status(401).send("Incorrect Password.");

    }

    else {

        const courseName = req.query.name;

        if (!courseName) {

            res.send(400).send("Missing lesson data.");

        }

        else {

            if (courseList.indexOf(courseName) == -1) {

                res.status(404).send("Content does not exist.");

            }

            else {

                try {

                    const session = await stripeAPI.checkout.sessions.create({

                        payment_intent_data: {

                            metadata: {

                                courseName

                            }

                        },

                        customer: customerID,

                        success_url: process.env.DOMAIN_NAME + `/course/${encodeURIComponent(courseName)}/content.html`,
                        cancel_url: process.env.DOMAIN_NAME + `/course/${encodeURIComponent(courseName)}/info.html`,

                        currency: "aud",
                        mode: "payment",
                        payment_method_types: ["card"],

                        line_items: [{ price: courseData[courseName].stripe_price_id, quantity: 1 }]

                    });

                    res.status(200).json({ URL: session.url });

                } catch (error) {

                    res.status(500).send(error.toString());


                }

            }

        }

    }

});

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {

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

    const t1 = database.init();

    t1.then(_ => {

        console.log("task 1/2 : database initialization successful");

    }).catch(error => {

        console.log(`task 1/2 : ${error}`);

    });

    console.log("task 2/2 : loading course data");

    courseData = JSON.parse(fs.readFileSync("course_data.json"));
    courseList = Object.keys(courseData);
    courseDescriptions = filterChildProperties(courseData, "description");
    courseTags = filterChildProperties(courseData, "tags");

    console.log("task 2/2 : course data loaded");

    await t1;

    console.log("tasks complete, listening on port " + process.env.PORT || 3000);

});