const cookieParser = require("cookie-parser");
const cors = require('cors');
const crypto = require("crypto");
const database = require("./database");
const ejs = require("ejs");
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
let courseDescriptions = {};
let courseTags = {};

let subIds = {};

const pageRoutes = fs.readdirSync("views/pages").map(x => `/${x.split(".")[0]}`);

const pageRedirectCallbacks = {

    account : async (req, res) => {

        if (!req.headers.auth) {

            res.status(401).redirect("/signup");

            return true;

        }

        return false;

    },

    signin : async (req, res) => {

        if (req.headers.auth) {

            res.status(409).redirect("/account");

            return true;

        }

        return false;

    },

    signup : async (req, res) => {

        if (req.headers.auth) {

            res.status(409).redirect("/account");

            return true;

        }

        return false;

    },

    getPro : async (req, res) => {

        const token = req.headers.auth;
        
        const courseName = req.query.courseName;

        if (token) {

            if (!courseList.includes(courseName)) {

                res.redirect("/learn");

                return true;

            }

            if (await database.checkIfPaidFor(token.userID, courseName)) {

                res.redirect(`/course/${courseName}`)

                return true;

            }

            return false;

        }

        return false;

    }

};

const ejsVars = {

    getPro : async (req, res) => {
        
        return {

            coursePrice : "20",
            monthlyPrice : "30",
            yearlyPrice : "60",

        }

    }

};

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

    await database.saveJWTId(userID, jwtID);

    return jwt.sign({ username: encrypt(username, "utf-8"), userID: encrypt(userID, "base64"), jwtID: encrypt(jwtID, "base64") }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES });

};

const getToken = async (token) => {

    try {

        const encryptedToken = jwt.verify(token, process.env.JWT_SECRET);

        const decryptedToken = { username : decrypt(encryptedToken.username, "utf-8"), userID : decrypt(encryptedToken.userID, "base64") }

        if (!(await database.verifyUserID(decryptedToken.username, decryptedToken.userID))) {

            return null;

        }

        if (!(await database.verifyJWTId(decryptedToken.userID, decrypt(encryptedToken.jwtID, "base64")))) {

            return null;

        }

        return decryptedToken;

    }

    catch (error) {

        return null;

    }

};

const getTokenMiddleware = async (req, res, next) => {

    await wait(crypto.randomInt(Number(process.env.MAX_DELAY_LENGTH)));

    const token = req.cookies.jwt ? (await getToken(req.cookies.jwt)) : null;

    req.headers.auth = token;

    next();

};

const indexRouteMiddle = (req, res, next) => {

    req.url = req.url == "/" ? "/index" : req.url;

    next();

};

const ejsRenderMiddleware = async (req, res, next) => {

    const route = req.url.split("?")[0];

    if (req.method == "GET" && pageRoutes.includes(route)) {

        const pageName = route.substring(1);
        const bodyPath = `pages/${pageName}.ejs`

        const redirect = pageRedirectCallbacks[pageName];

        if (redirect) {

            if (await redirect(req, res)) {

                return;

            }

        }

        let pageVars = {};

        const pageVarFunc = ejsVars[pageName];

        if (pageVarFunc) {

            pageVars = await pageVarFunc(req, res)

        }

        let accountVars = {
            
            accountRoute : req.headers.auth ? "/account" : "/signup", 
            accountText : req.headers.auth ? "Account" : "Signup"
    
        };

        res.status(200).render("main", Object.assign({ pageName, bodyPath }, accountVars, pageVars));

    }

    else {

        next();

    }

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

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {

    let event = req.body;

    const sig = req.headers["stripe-signature"];

    try {

        event = stripeAPI.webhooks.constructEvent(event, sig, process.env.STRIPE_WEBHOOK_SIGNING);

    } catch (error) {

        res.status(400).send(error);

        return;

    }

    switch (event.type) {

        case "checkout.session.completed":

            if (event.data.object.mode == "subscription") {

                return;

            }

            console.log(event)

            res.status(200).end();

            break;

        case "customer.subscription.created":

            const subId = event.data.object.id;

            console.log(subId);

            res.status(200).end();

            break;

    }

});

app.use(cors({ origin : true }))
app.use(morgan(":date - :client-ip - :user-agent - :url"));
app.use(cookieParser());
app.use(getTokenMiddleware);
app.use(indexRouteMiddle);
app.use(ejsRenderMiddleware);

app.set('views', './views');
app.set("view engine", "ejs");

app.use(express.static("assets"));

app.post("/signup", express.json(), async (req, res) => {

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

            res.status(401).send("Incorrect username or password.");

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

app.post("/learnRedirect", express.json(), async (req, res) => {

    const courseName = req.body.courseName;

    if (!courseName) {

        res.status(400).send("Missing request data.");

        return;

    }

    if (!courseList.includes(courseName)) {

        res.send(404).send("Course does not exist.");

        return;

    }

    const token = req.headers.auth;

    if (!req.headers.auth) {

        res.status(200).redirect("/signup");

    }

    const paidFor = await database.checkIfPaidFor(token.userID, courseName);

    if (paidFor) {

        res.status(200).json({ url : `/course/${encodeURIComponent(courseName)}`});

    }

    else {

        res.status(200).json({ url : `/getPro?courseName=${encodeURIComponent(courseName)}`})

    }

});

app.post("/buyRedirect", express.json(), async (req, res) => {

    const item = req.body.item;
    const password = req.body.password;

    const token = req.headers.auth;

    if (!item || password === undefined) {

        res.status(400).send("Missing request data.");

        return;

    }

    if (!password) {

        res.status(400).send("Please enter your password.");
        
        return;

    }

    const testUserID = await database.getUserID(token.username, password)

    if (!testUserID || !(crypto.timingSafeEqual(Buffer.from(testUserID, "base64"), Buffer.from(token.userID, "base64")))) {

        res.status(401).send("Incorrect password.");

        return;

    }

    if (!token) {

        res.status(401).send("Please sign in before purchasing a course.");

        return;

    }

    const paidFor = await database.checkIfPaidFor(token.userID, item);

    if (paidFor) {

        res.status(409).send("You have already paid for this course.");

    }

    const customerID = await database.getCustomerID(token.userID, password);

    let session;

    switch (item) {

        case "monthly-sub":
            
            session = await stripeAPI.checkout.sessions.create({

                metadata : {

                    item
                    
                },

                customer : customerID,

                success_url : process.env.DOMAIN_NAME + "/learn",
                cancel_url : process.env.DOMAIN_NAME + "/learn",

                currency:  "aud",
                mode : "subscription",
                payment_method_types : ["card"],

                line_items : [{ price : subIds.monthly, quantity : 1 }]


            });


            break;
    
        case "yearly-sub":

            session = await stripeAPI.checkout.sessions.create({

                metadata : {

                    item
                    
                },

                customer : customerID,

                success_url : process.env.DOMAIN_NAME + "/learn",
                cancel_url : process.env.DOMAIN_NAME + "/learn",

                currency : "aud",
                mode : "subscription",
                payment_method_types : ["card"],

                line_items : [{ price : subIds.yearly, quantity : 1 }]


            });

            break;

        default:

            if (courseList.includes(item)) {

                session = await stripeAPI.checkout.sessions.create({

                    metadata : {

                        item
                        
                    },

                    customer : customerID,
    
                    success_url : process.env.DOMAIN_NAME + `/course/${encodeURIComponent(item)}`,
                    cancel_url : process.env.DOMAIN_NAME + "/learn",
    
                    currency : "aud",
                    mode : "payment",
                    payment_method_types : ["card"],
    
                    line_items : [{ price : courseData[item].stripe_price_id, quantity : 1 }]
    
    
                });

            }

            else {

                res.status(404).send("Course does not exist.");

                return;

            }

            break;

    }

    if (session.url) {

        res.status(200).json({ url : session.url });

    }

});

app.get("/getCourseData", express.json(), async (req, res) => {

    const data = req.headers;

    const token = req.headers.auth;

    if (!token && data.filter == "true") {

        res.status(401).send("You are not signed in, please sign in to see your paid for courses.");

    }

    else {

        if (data.filter == "true") {

            const userID = token.userID;

            const filteredCourseList = [];

            for (let i = 0; i < courseList.length; i++) {

                try {

                    if ((await database.checkIfPaidFor(userID, courseList[i]))) {

                        filteredCourseList.push(courseList[i])

                    }

                } catch (error) {

                    res.status(500).send(error.toString());

                    return;

                }

            }

            res.status(200).json({ courseList: filteredCourseList, courseDescriptions, courseTags });

        }

        else {

            res.status(200).json({ courseList, courseDescriptions, courseTags });

        }

    }

});

app.get("/video", express.json(), async (req, res) => {

    const token = req.headers.auth;

    if (!token) {

        res.status(401).send("You are not signed in, please sign in to access your course.");

    }

    else {

        const courseName = req.query.courseName;

        if (!courseList.includes(courseName)) {

            res.status(404).send("Course does not exist.");

            return;

        }

        let coursePaidFor;

        try {

            coursePaidFor = await database.checkIfPaidFor(token.userID, courseName);

        } catch (error) {

            res.status(500).send(error.toString());

            return;

        }

        if (!coursePaidFor) {

            res.send(403).send("You have not paid for this course.");

            return;

        }

        let range = req.headers.range;

        if (!range) {

            res.status(400).send("No range provided.");

        }

        else {

            const filePath = ""; // TODO

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

    subIds = JSON.parse(fs.readFileSync("sub_ids.json"));

    console.log("task 2/2 : course data loaded");

    await t1;

    console.log("tasks complete, listening on port " + process.env.PORT || 3000);

});