import cookieParser from "cookie-parser";
import cors from "cors"
import crypto from "crypto"
import database from "./database.js"
import dotenv from "dotenv"
import ejs from "ejs"
import express from "express";
import fs from "fs"
import jwt from "jsonwebtoken"
import morgan from "morgan"
import stripe from "stripe"
import utils from "./utils.js"
import ai from "./ai.js"

dotenv.config();

const pageRoutes = fs.readdirSync("views/pages").map(x => `/${x.split(".")[0]}`);
const subIds = await database.config.getConfigData("sub_ids");
const courseData = await database.config.getConfigData("course_data");
const courseIDs = Object.keys(courseData);

const handleRequestError = (error, res) => {

    if (error.throwErrorToClient) {

        error.throwErrorToClient(res);

    }

    else {

        utils.createLog(error.toString(), "ERROR", "0x000000");

        res.status(500).json({ error });

    }

};

const pageRedirectCallbacks = {

    account: async (req, res) => {

        if (!req.headers.auth || req.headers.auth.mfaRequired) {

            res.status(401).redirect("/index");

            return true;

        }

        return false;

    },

    signin: async (req, res) => {

        if (req.headers.auth && !req.headers.auth.mfaRequired) {

            res.status(409).redirect("/account");

            return true;

        }

        return false;

    },

    signup: async (req, res) => {

        if (req.headers.auth && !req.headers.auth.mfaRequired) {

            res.status(409).redirect("/account");

            return true;

        }

        return false;

    },

    getPro: async (req, res) => {

        const token = req.headers.auth;

        const courseID = req.query.courseID;

        if (token && !token.mfaRequired) {

            if (!courseIDs.includes(courseID)) {

                res.redirect("/learn");

                return true;

            }

            if (await database.payments.checkIfPaidFor(token.userID, courseID)) {

                res.redirect(`/course?courseID=${courseID}`)

                return true;

            }

            return false;

        }

        return false;

    },

    course: async (req, res) => {

        const token = req.headers.auth;

        if (!token || token.mfaRequired) {

            res.status(401).redirect("/index");

            return true;

        }

        if (!req.query.courseID) {

            res.status(400).redirect("/learn");

            return true;

        }

        let additionalQueryParams = "";

        if (!req.query.contentID) {

            const contentID = await ai.getContentID(token.userID, req.query.courseID);

            additionalQueryParams += `&contentID=${contentID}`;

        }

        if (!req.query.lessonNumber || !req.query.lessonChunk) {

            const lessonIndexes = await database.courses.getLessonIndexes(token.userID, req.query.courseID);

            if (!req.query.lessonNumber) {

                additionalQueryParams += `&lessonNumber=${lessonIndexes[0]}`;
                
            }

            if (!req.query.lessonChunk) {

                additionalQueryParams += `&lessonChunk=${lessonIndexes[1]}`;
                
            }

        }

        if (additionalQueryParams) {

            res.status(200).redirect(req.originalUrl + additionalQueryParams);

            return true;

        }

        return false;

    }

};

const ejsVars = {

    getPro: async (req, res) => {

        return {

            coursePrice: "20",
            monthlyPrice: "30",
            yearlyPrice: "60",
            courseName: courseData[req.query.courseID].title

        }

    },

    account: async (req, res) => {

        let username;
        let email;

        const token = req.headers.auth;

        if (!token) {

            username = email = "Please sign in to view you account info.";

        }

        else {

            username = token.username;
            email = (await database.users.getUserInfo(token.userID, "userID", ["email"]))[0].email;

        }

        return {

            username,
            email

        }

    }

};


const generateToken = async (username, userID, mfaRequired) => {

    const jwtID = crypto.randomBytes(+process.env.JWT_ID_SIZE).toString("base64");

    await database.authorization.saveJWTId(userID, jwtID);

    return jwt.sign({ username: utils.encrypt(username, "utf-8"), userID: utils.encrypt(userID, "base64"), jwtID: utils.encrypt(jwtID, "base64"), mfaRequired }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES });

};

const getToken = async (token) => {

    try {

        const encryptedToken = jwt.verify(token, process.env.JWT_SECRET);

        const decryptedToken = { username: utils.decrypt(encryptedToken.username, "utf-8"), userID: utils.decrypt(encryptedToken.userID, "base64"), mfaRequired: encryptedToken.mfaRequired }

        if (!(await database.verification.verifyUserID(decryptedToken.username, decryptedToken.userID))) {

            return null;

        }

        if (!(await database.authorization.verifyJWTId(decryptedToken.userID, utils.decrypt(encryptedToken.jwtID, "base64")))) {

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

const tokenMFARequiredFilterMiddleware = (req, res, next) => {

    if (req.headers.auth?.mfaRequired == true) {

        req.headers.auth = null;

    }

    next();

}

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

            pageVars = await pageVarFunc(req, res);

        }

        let accountVars = {

            accountRoute: req.headers.auth ? "/account" : "/signup",
            accountText: req.headers.auth ? "Account" : "Signup"

        };

        res.status(200).render("main", Object.assign({ pageName, bodyPath }, accountVars, pageVars));

    }

    else {

        next();

    }

};

morgan.token("client-ip", (req) => {

    // attempts to reveal original ip address when client using proxies

    const header = req.headers["x-forwarded-for"];

    return header || req.ip;

});

const stripeAPI = stripe(process.env.STRIPE_SK);

const app = express();

app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {

    try {

        let event = req.body;

        const sig = req.headers["stripe-signature"];

        try {

            event = stripeAPI.webhooks.constructEvent(event, sig, process.env.STRIPE_WEBHOOK_SIGNING);

        }

        catch (error) {

            new utils.ErrorHandler("0x00000F").throwError();

        }

        switch (event.type) {

            case "checkout.session.completed":

                if (event.data.object.mode == "subscription") {

                    res.status(204).json({ msg: "OK." });

                    return;

                }

                const sessionID = event.data.object.metadata.sessionID;

                res.status(200).json({ msg: "OK." });

                const sessionData = await database.payments.getCheckoutSession(sessionID);

                await database.payments.addCoursePayment(sessionData.userID, sessionData.item)

                break;

            case "customer.subscription.created":

                const customerID = event.data.object.customer;
                const subID = event.data.object.id;

                res.status(200).json({ msg: "OK." });

                await database.payments.updateSubID(customerID, subID)

                break;

        }

    }

    catch (error) {

        handleRequestError(error, res);

    }

});

app.use(morgan(":date - :client-ip - :user-agent - :method :url"));
app.use(cookieParser());
app.use(getTokenMiddleware);
app.use(indexRouteMiddle);
app.use(ejsRenderMiddleware);

app.set('views', './views');
app.set("view engine", "ejs");

app.use(express.static("assets"));

app.post("/signup", express.json(), async (req, res) => {

    try {

        if (req.headers.auth) {

            res.status(409).json({ msg: "You are already signed in." });

            return;

        }

        const data = req.body;

        if (!data) {

            res.status(400).json({ msg: "Missing requeust data." });

            return;

        }

        const username = data.username;
        const email = data.email;
        const password = data.password;

        if (!username || !email || !password) {

            res.status(400).json({ msg: "Mising sign up data." });

            return;

        }

        const userID = await database.users.addNewUser(username, email, password);

        const jwtToken = await generateToken(username, userID, true);

        res.status(201).cookie("jwt", jwtToken, { httpOnly: true, maxAge: 1000 * 60 * 30 }).json({ msg: "OK." });

    }

    catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/signin", express.json(), async (req, res) => {

    try {

        if (req.headers.auth && !req.headers.auth.mfaRequired) {

            res.status(409).json({ msg: "You are already signed in." });

            return;

        }

        const data = req.body


        if (!data) {

            res.status(400).json({ msg: "Missing request data." });

            return;

        }

        const username = data.username;
        const password = data.password;

        if (!username || !password) {

            res.status(400).json({ msg: "Mising sign in data." });

            return;

        }

        else {

            if (!(await database.authentication.verifyPassword(username, password))) {

                res.status(401).json({ msg: "Incorrect username or password." });

                return;

            }

            const userID = (await database.users.getUserInfo(username, "username", ["userID"]))[0].userID;

            await database.authentication.sendMFAEmail(userID);

            const jwtToken = await generateToken(username, userID, true);

            res.status(200).cookie("jwt", jwtToken, { httpOnly: true, maxAge: 1000 * 60 * 30, }).json({ msg: "OK." });

        }

    }

    catch (error) {

        handleRequestError(error, res);

        return;

    }

});

app.post("/completeMFA", express.json(), async (req, res) => {

    try {

        const token = req.headers.auth;

        const code = req.body.code;

        if (!token) {

            res.status(401).json({ msg: "Authentication process has not been started, please start authentication process to complete MFA." });

            return;

        }

        if (!token.mfaRequired) {

            res.status(409).json({ msg: "MFA has already been completed." });

        }

        if (!code) {

            res.status(400).json({ msg: "Missing request data." });

        }

        const codeOK = await database.authentication.verifyMFACode(token.userID, code);

        if (codeOK) {

            const jwtToken = await generateToken(token.username, token.userID, false);

            res.status(200).cookie("jwt", jwtToken, { httpOnly: true, maxAge: process.env.JWT_EXPIRES_MS }).json({ msg: "OK." });

        }

        else {

            res.status(401).json({ msg: "MFA code is invalid." });

        }

    }

    catch (error) {

        handleRequestError(error, res);

        return;

    }

});

app.use(tokenMFARequiredFilterMiddleware);

app.post("/deleteAccount", express.json(), async (req, res) => {

    try {

        const token = req.headers.auth;
        const password = req.body.password

        if (!token) {

            res.status(401).json({ msg: "Please sign in before deleting your account." });

            return;

        }

        if (!password) {

            res.status(400).json({ msg: "Please enter your password to delete your account." });

            return;

        }

        const username = token.username;
        const userID = token.userID;

        if (!(await database.authentication.verifyPassword(username, password))) {

            res.status(401).json({ msg: "Incorrect password." });

            return;

        }

        await database.users.deleteUser(username, userID);

        res.status(200).clearCookie("jwt").json({ msg: "OK." });

    }

    catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/changeUserDetails", express.json(), async (req, res) => {

    try {

        const token = req.headers.auth;
        const data = req.body;

        if (!token) {

            res.status(401).json({ msg: `Please sign in to change your ${data.toChangePropertyName}` });

            return;

        }

        if (!data.toChangeValue || !data.toChangePropertyName) {

            res.status(400).json({ msg: "Missing request parameters." });

            return;

        }

        await database.users.changeUserInfo(token.userID, "userID", data.toChangeValue, data.toChangePropertyName);

        if (data.toChangePropertyName == "username") {

            res.status(200).cookie("jwt", await generateToken(data.toChangeValue, token.userID), { httpOnly: true, maxAge: process.env.JWT_EXPIRES_MS, overwrite: true }).json({ msg: "OK." });

            return;

        }

        res.status(200).json({ msg: "OK." });

    }

    catch (error) {

        handleRequestError(error, res);

    }

});


app.post("/learnRedirect", express.json(), async (req, res) => {

    try {

        const token = req.headers.auth;
        const courseID = req.body.courseID;

        if (!token) {

            res.status(401).json({ msg: "Please sign in to purchase courses. " });

            return;

        }

        if (!courseID) {

            res.status(400).json({ msg: "Missing request data." });

            return;

        }

        if (!courseIDs.includes(courseID)) {

            res.send(404).json({ msg: "Course does not exist." });

            return;

        }

        if (!token) {

            res.status(200).json({ msg: "OK.", url: `/getPro?courseID=${encodeURIComponent(courseID)}` });

            return;

        }

        const paidFor = await database.payments.checkIfPaidFor(token.userID, courseID);

        if (paidFor) {

            res.status(200).json({ msg: "OK.", url: `/course?courseID=${encodeURIComponent(courseID)}` });

        }

        else {

            res.status(200).json({ msg: "OK.", url: `/getPro?courseID=${encodeURIComponent(courseID)}` });

        }

    }

    catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/buyRedirect", express.json(), async (req, res) => {

    try {

        const item = req.body.item;
        const password = req.body.password;

        const token = req.headers.auth;

        if (!token) {

            res.status(401).json({ msg: "Please sign in before purchasing a course." });

            return;

        }

        if (!item || password === undefined) {

            res.status(400).json({ msg: "Missing request data." });

            return;

        }

        if (!password) {

            res.status(400).json({ msg: "Please enter your password." });

            return;

        }

        if (!(await database.authentication.verifyPassword(token.username, password))) {

            res.status(401).json({ msg: "Incorrect password." });

            return;

        }

        const paidFor = await database.payments.checkIfPaidFor(token.userID, item);

        if (paidFor) {

            res.status(409).json({ msg: "You have already paid for this course." });

        }

        const customerID = (await database.users.getUserInfo(token.userID, "userID", ["stripeCustomerID"]))[0].stripeCustomerID;

        let line_items;

        switch (item) {

            case "monthly-sub":

                line_items = [{ price: subIds.monthly, quantity: 1 }];

                break;

            case "yearly-sub":

                line_items = [{ price: subIds.yearly, quantity: 1 }]

                break;

            default:

                if (courseIDs.includes(item)) {

                    line_items = [{ price: courseData[item].stripe_price_id, quantity: 1 }]

                }

                else {

                    res.status(404).json({ msg: "Course does not exist." });

                    return;

                }

                break;

        }

        const sessionID = crypto.randomBytes(256).toString("base64")

        await database.payments.createCheckoutSession(sessionID, token.userID, item)

        const session = await stripeAPI.checkout.sessions.create({

            metadata: {

                sessionID

            },

            customer: customerID,

            success_url: process.env.DOMAIN_NAME + `/course?courseID=${req.query.courseID}`,
            cancel_url: process.env.DOMAIN_NAME + "/learn",

            currency: "aud",
            mode: item.slice(-3) == "sub" ? "subscription" : "payment",
            payment_method_types: ["card"],

            line_items


        });

        res.status(200).json({ msg: "OK.", url: session.url });

    }

    catch (error) {

        handleRequestError(error, res);

    }

});

app.get("/getCourseData", express.json(), async (req, res) => {

    try {

        const data = req.headers;

        const token = req.headers.auth;

        if (!token && data.filter == "true") {

            res.status(401).json({ msg: "You are not signed in, please sign in to see your paid for courses." });

        }

        else {

            if (data.filter == "true") {

                const userID = token.userID;

                const filteredCourseIDList = [];

                for (let i = 0; i < courseIDs.length; i++) {

                    if ((await database.payments.checkIfPaidFor(userID, courseIDs[i]))) {

                        filteredCourseIDList.push(courseIDs[i])

                    }

                }

                res.status(200).json({ msg: "OK.", courseIDs: filteredCourseIDList, courseData });

            }

            else {

                res.status(200).json({ msg: "OK.", courseIDs, courseIDs, courseData });

            }

        }

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/verifyHMACSignature", express.json(), (req, res) => {

    const signature = crypto.createHmac(process.env.HASHING_ALGORITHM, process.env.HMAC_SECRET).update(req.body.data).digest()

    res.status(200).json({ msg : "OK.", verified : crypto.timingSafeEqual(Buffer.from(req.body.signature, "base64url"), signature) })

});

app.post("/completeLessonChunk", express.json(), async (req, res) => {

    const token = req.headers.auth;
    const data = req.body;

    if (!token) {

        res.status(401).json({ msg : "Please sign in to access learning content. " });

    }

    if (!data.lessonNumber || !data.lessonChunk || !data.courseID) {

        res.status(400).json({ msg : "Missing request data." });

    }

    if ((await database.ai.getUserNumChunks(token.userID)) <= req.lessonChunk) {

        res.status(406).json({ msg : "Lesson is complete, please send request to /completeLesson." });

    }

    await database.courses.incrementLessonIndexes(data.courseID, 1);

    const contentID = await ai.getContentID(token.userID, data.courseID);

    res.status(200).redirect(`/course?lessonNumber=${data.lessonNumber}&lessonChunk=${data.lessonChunnk + 1}&courseID=${data.courseID}contentID=${contentID}`)

});

app.post("/completeLesson", express.json(), async (req, res) => {

    const token = req.headers.auth;
    const data = req.body;

    if (!token) {

        res.status(401).json({ msg : "Please sign in to access learning content." });

        return;
 
    }

    if (!data.lessonNumber || !data.lessonChunk || !data.courseID || !data.quizScore) {

        res.status(400).json({ msg : "Missing request data." });

        return;
 
    }

    if (!(data.quizScore >= 0 && data.quizScore <= 1)) {

        res.status(406).json({ msg : "Quiz score is invalid." });

        return;
 
    }

    if ((await database.ai.getUserNumChunks(token.userID)) > req.lessonChunk) {

        res.status(406).json({ msg : "Lesson is incomplete, please send request to /completeLessonChunk." });

        return;
 
    }

    await database.courses.incrementLessonIndexes(data.courseID, 0);

    const sessionTimes = await database.courses.getSessionTimes(token.userID, data.courseID)

    const averageSessionTime = (sessionTimes).reduce((acc, elem) => acc + elem)/sessionTimes.length;

    await ai.updateAI(token.userID, data.courseData, data.lessonNumber, data.quizScore, averageSessionTime)

    const contentID = await ai.getContentID(token.userID, data.courseID);

    res.status(200).redirect(`/course?lessonNumber=${datalessonNumber + 1}&lessonChunk=${1}&courseID=${data.courseID}contentID=${contentID}`)

});

app.post("/logSessionTime", express.json(), async (req, res) => {

    const token = req.headers.auth;

    if (!token) {

        res.status(401).json({ msg : "Please sign in to log session times." });

        return;
 
    }

    if (!req.body.sessionTime) {

        res.status(400).json({ msg : "Missing request data." })

        return;

    }

    await database.courses.updateSessionTimes(token.userID, req.body.courseID, req.body.sessionTime);

    res.status(200).json({ msg : "OK." });

});

app.listen(process.env.PORT || 3000, () => {

    console.log(`listening on port ${process.env.PORT || 3000}`);

});