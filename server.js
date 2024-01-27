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
import nodemailer from "nodemailer"
import stripe from "stripe"
import utils from "./utils.js"
import ai from "./ai.js"

dotenv.config();

const pageRoutes = fs.readdirSync("views/pages").map(x => `/${x.split(".")[0]}`);
const subIDs = await database.config.getConfigData("sub_ids");
const courseData = await database.config.getConfigData("course_data");
const courseIDs = Object.keys(courseData);
const requestParameters = JSON.parse(fs.readFileSync("request_parameters.json"));

const notificationEmailTransport = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.NOTIFICATION_EMAIL_ADDRESS,
        pass: process.env.NOTIFICATION_EMAIL_APP_PASSWORD
    },
});

const handleRequestError = (error, res) => {

    if (error.throwErrorToClient) {

        error.throwErrorToClient(res);

    }

    else {

        utils.createLog(error.toString(), "DEFAULT");

        res.status(500).json({ msg : error.toString() });

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

        if (!req.query.courseID || !courseIDs.includes(req.query.courseID)) {

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
        let paymentMethod;
        let subStatus;

        const token = req.headers.auth;

        if (!token) {

            subStatus = paymentMethod = username = email = "Please sign in to view your account info.";

        }

        else {

            username = token.username;

            const userData = (await database.users.getUserInfo(token.userID, "userID", ["email", "stripeCustomerID"]))[0]

            email = userData.email;

            const stripeCustomerID = userData.stripeCustomerID;
            
            const paymentMethods = await stripeAPI.customers.listPaymentMethods(stripeCustomerID, { limit: 1 });

            if (paymentMethods.data.length == 0) {

                paymentMethod = "No payment method set."

            }

            else {

                const last4CardDigits = paymentMethods.data[0].card?.last4;

                paymentMethod = `Card ending in ${last4CardDigits}.`


            }

            const subID = await database.payments.getSubID(token.userID);

            if (!subID) {

                subStatus = "None"

            }

            else {

                const subscription = await stripeAPI.subscriptions.retrieve(subID);

                switch (subscription.items.data[0].price.id) {

                    case subIDs.monthly:

                        subStatus = "Monthly";

                        break;

                    case subIDs.yearly:

                        subStatus = "Yearly";

                        break;

                    default:

                        subStatus = "None";

                        break;

                }

            }


        }

        return {

            username,
            email,
            paymentMethod,
            subStatus

        }

    },

    courseCompleted: async (req, res) => {

        return {

            courseName: courseData[req.query.courseID].title

        }

    }

};

const ejsAdditionalHTML = {};

const generateToken = async (username, userID, mfaRequired) => {

    const jwtID = crypto.randomBytes(+process.env.JWT_ID_SIZE).toString("base64");

    await database.authorization.saveJWTId(userID, jwtID);

    return jwt.sign({ username: utils.encrypt(username, "utf-8"), userID: utils.encrypt(userID, "base64"), jwtID: utils.encrypt(jwtID, "base64"), mfaRequired }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES });

};

const getToken = async (token) => {

    try {

        const encryptedToken = jwt.verify(token, process.env.JWT_SECRET);

        const decryptedToken = { username: utils.decrypt(encryptedToken.username, "utf-8"), userID: utils.decrypt(encryptedToken.userID, "base64"), jwtID : utils.decrypt(encryptedToken.jwtID, "base64"), mfaRequired: encryptedToken.mfaRequired }

        if (!(await database.verification.verifyUserID(decryptedToken.username, decryptedToken.userID))) {

            return null;

        }

        if (!(await database.authorization.verifyJWTId(decryptedToken.userID, decryptedToken.jwtID))) {

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

const requestVerifcationMiddleware = (req, res, next) => {

    if (requestParameters[req.url] && requestParameters[req.url].methodToMatch == req.method) {

        const token = req.headers.auth;

        if (requestParameters[req.url].mustBeSignedIn && !token) {

            new utils.ErrorHandler("0x000001", `Must be signed in to make a request to ${req.url}.`).throwErrorToClient(res);

            return;

        }

        if (requestParameters[req.url].mustBeSignedIn && !requestParameters[req.url].mfaMustBeRequired && token.mfaRequired) {

            new utils.ErrorHandler("0x000003", `MFA must be completed to make a request to ${req.url}.`).throwErrorToClient(res);

            return;

        }

        if (requestParameters[req.url].mustBeSignedOut && token) {

            new utils.ErrorHandler("0x000002", `Must not be signed in to make a request to ${req.url}.`).throwErrorToClient(res);

            return;

        }

        if (requestParameters[req.url].mfaMustBeRequired && (!token || !token.mfaRequired)) {

            new utils.ErrorHandler("0x000004", `MFA must not be completed to make a request to ${req.url}.`).throwErrorToClient(res);

            return;

        }

        const expectedRequestBodyData = requestParameters[req.url].bodyParameters || {};
        const expectedRequestQueryData = requestParameters[req.url].queryParameters || {};
        const expectedRequestBodyParameters = Object.keys(expectedRequestBodyData);
        const expectedRequestQueryParameters = Object.keys(expectedRequestQueryData);

        if (expectedRequestBodyParameters.length > 0) {

            const data = req.body;

            if (!data) {

                new utils.ErrorHandler("0x000005", "Request body is missing.").throwErrorToClient(res);

                return;

            }

            for (let i = 0; i < expectedRequestBodyParameters.length; i++) {

                if (data[expectedRequestBodyParameters[i]] === undefined) {

                    new utils.ErrorHandler("0x000006", `Body parameter ${expectedRequestBodyParameters[i]} is missing.`).throwErrorToClient(res);

                    return;

                }

                if (expectedRequestBodyData[expectedRequestBodyParameters[i]].type && typeof data[expectedRequestBodyParameters[i]] != expectedRequestBodyData[expectedRequestBodyParameters[i]].type) {

                    new utils.ErrorHandler("0x000007", `Body parameter ${expectedRequestBodyParameters[i]} is of the incorrect type, expected ${expectedRequestBodyData[expectedRequestBodyParameters[i]].type}, received ${typeof data[expectedRequestBodyParameters[i]]}.`).throwErrorToClient(res);

                    return;

                }

                switch (expectedRequestBodyData[expectedRequestBodyParameters[i]].format) {

                    case "binary":

                        if (!(/^[01]+$/.test(data[expectedRequestBodyParameters[i]]))) {

                            new utils.ErrorHandler("0x000008", `Body parameter ${expectedRequestBodyParameters[i]} is of the incorrect format, expected binary.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                    case "hex":

                        if (!(/^[0-9A-Fa-f]+$/.test(data[expectedRequestBodyParameters[i]]))) {

                            new utils.ErrorHandler("0x000008", `Body parameter ${expectedRequestBodyParameters[i]} is of the incorrect format, expected hex.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                    case "base64":

                        if (!(/^[A-Za-z0-9+/]+={0,3}$/.test(data[expectedRequestBodyParameters[i]]))) {

                            new utils.ErrorHandler("0x000008", `Body parameter ${expectedRequestBodyParameters[i]} is of the incorrect format, expected base64.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                    case "base64url":

                        if (!(/^[A-Za-z0-9-_]+={0,3}$/.test(data[expectedRequestBodyParameters[i]]))) {

                            new utils.ErrorHandler("0x000008", `Body parameter ${expectedRequestBodyParameters[i]} is of the incorrect format, expected base64url.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                    case "integer":

                        if (!Number.isInteger(data[expectedRequestBodyParameters[i]])) {

                            new utils.ErrorHandler("0x000008", `Body parameter ${expectedRequestBodyParameters[i]} is of the incorrect format, expected integer.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                    case "float":

                        if (Number.isInteger(data[expectedRequestBodyParameters[i]])) {

                            new utils.ErrorHandler("0x000008", `Body parameter ${expectedRequestBodyParameters[i]} is of the incorrect format, expected float.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                }

                if (expectedRequestBodyData[expectedRequestBodyParameters[i]].minimumValue) {

                    if (data[expectedRequestBodyParameters[i]] < expectedRequestBodyData[expectedRequestBodyParameters[i]].minimumValue) {

                        new utils.ErrorHandler("0x000009").throwErrorToClient(res);

                    }

                }

                if (expectedRequestBodyData[expectedRequestBodyParameters[i]].maximumValue) {

                    if (data[expectedRequestBodyParameters[i]] > expectedRequestBodyData[expectedRequestBodyParameters[i]].maximumValue) {

                        new utils.ErrorHandler("0x000009").throwErrorToClient(res);

                    }

                }

                if (expectedRequestBodyData[expectedRequestBodyParameters[i]].possibleValues) {

                    if (!expectedRequestBodyData[expectedRequestBodyParameters[i]].possibleValues.includes(data[expectedRequestBodyParameters[i]])) {

                        new utils.ErrorHandler("0x00000A", `Body parameter ${expectedRequestBodyParameters[i]} is invalid, value must be one of ${expectedRequestBodyData[expectedRequestBodyParameters[i]].possibleValues.toString()}`).throwErrorToClient(res);

                        return;

                    }

                }

            }

        }

        if (expectedRequestQueryParameters.length > 0) {

            const data = JSON.parse(req.query);

            if (!data) {

                new utils.ErrorHandler("0x00000B", "Request query is missing.").throwErrorToClient(res);

                return;

            }

            for (let i = 0; i < expectedRequestQueryParameters.length; i++) {

                if (data[expectedRequestQueryParameters[i]] === undefined) {

                    new utils.ErrorHandler("0x00000C", `Query parameter ${expectedRequestQueryParameters[i]} is missing.`).throwErrorToClient(res);

                    return;

                }

                if (expectedRequestQueryData[expectedRequestQueryParameters[i]].type && typeof data[expectedRequestQueryParameters[i]] != expectedRequestQueryData[expectedRequestQueryParameters[i]].type) {

                    new utils.ErrorHandler("0x00000D", `Query parameter ${expectedRequestQueryParameters[i]} is of the incorrect type, expected ${expectedRequestQueryData[expectedRequestQueryParameters[i]].type}, received ${typeof data[expectedRequestQueryParameters[i]]}.`).throwErrorToClient(res);

                    return;

                }

                switch (expectedRequestQueryData[expectedRequestQueryParameters[i]].format) {

                    case "binary":

                        if (!(/^[01]+$/.test(data[expectedRequestQueryParameters[i]]))) {

                            new utils.ErrorHandler("0x00000E", `Query parameter ${expectedRequestQueryParameters[i]} is of the incorrect format, expected binary.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                    case "hex":

                        if (!(/^[0-9A-Fa-f]+$/.test(data[expectedRequestQueryParameters[i]]))) {

                            new utils.ErrorHandler("0x00000E", `Query parameter ${expectedRequestQueryParameters[i]} is of the incorrect format, expected hex.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                    case "base64":

                        if (!(/^[A-Za-z0-9+/]+={0,3}$/.test(data[expectedRequestQueryParameters[i]]))) {

                            new utils.ErrorHandler("0x00000E", `Query parameter ${expectedRequestQueryParameters[i]} is of the incorrect format, expected base64.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                    case "base64url":

                        if (!(/^[A-Za-z0-9-_]+={0,3}$/.test(data[expectedRequestQueryParameters[i]]))) {

                            new utils.ErrorHandler("0x00000E", `Query parameter ${expectedRequestQueryParameters[i]} is of the incorrect format, expected base64url.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                    case "integer":

                        if (!Number.isInteger(data[expectedRequestQueryParameters[i]])) {

                            new utils.ErrorHandler("0x00000E", `Query parameter ${expectedRequestQueryParameters[i]} is of the incorrect format, expected integer.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                    case "float":

                        if (Number.isInteger(data[expectedRequestQueryParameters[i]])) {

                            new utils.ErrorHandler("0x00000E", `Query parameter ${expectedRequestQueryParameters[i]} is of the incorrect format, expected float.`).throwErrorToClient(res);

                            return;

                        }

                        break;

                }

                if (expectedRequestQueryData[expectedRequestQueryParameters[i]].minimumValue) {

                    if (data[expectedRequestQueryParameters[i]] < expectedRequestQueryData[expectedRequestQueryParameters[i]].minimumValue) {

                        new utils.ErrorHandler("0x00000F").throwErrorToClient(res);

                    }

                }

                if (expectedRequestQueryData[expectedRequestQueryParameters[i]].maximumValue) {

                    if (data[expectedRequestQueryParameters[i]] > expectedRequestQueryData[expectedRequestQueryParameters[i]].maximumValue) {

                        new utils.ErrorHandler("0x00000F").throwErrorToClient(res);

                    }

                }

                if (expectedRequestQueryData[expectedRequestQueryParameters[i]].possibleValues) {

                    if (!expectedRequestQueryData[expectedRequestQueryParameters[i]].possibleValues.includes(data[expectedRequestQueryParameters[i]])) {

                        new utils.ErrorHandler("0x000010", `Query parameter ${expectedRequestQueryParameters[i]} is invalid, value must be one of ${expectedRequestQueryData[expectedRequestQueryParameters[i]].possibleValues.toString()}`).throwErrorToClient(res);

                        return;

                    }

                }

            }

        }
        
        next();

    }

    else {

        next();

    }

}

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

        let additionalHTML = {};

        const additionalHTMLFunc = ejsAdditionalHTML[pageName];

        if (additionalHTMLFunc) {

            additionalHTML = await additionalHTMLFunc(req, res);

        }

        let accountVars = {

            accountRoute: req.headers.auth ? "/account" : "/signup",
            accountText: req.headers.auth ? "Account" : "Signup"

        };

        res.status(200).render("main", Object.assign({ pageName, bodyPath }, accountVars, pageVars, additionalHTML));

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

    let event = req.body;

    const sig = req.headers["stripe-signature"];

    try {

        event = stripeAPI.webhooks.constructEvent(event, sig, process.env.STRIPE_WEBHOOK_SIGNING);

    }

    catch (error) {

        new utils.ErrorHandler("0x00000F").throwErrorToClient(res);

    }

    const customerID = event.data.object.customer;

    const { email, username } = (await database.users.getUserInfo(customerID, "stripeCustomerID", ["email", "username"]))[0];

    let charge;
    let invoice;

    try {

        switch (event.type) {

            case "checkout.session.completed":

                const sessionID = event.data.object.metadata.sessionID;

                if (event.data.object.mode == "subscription") {

                    res.status(204).json({ msg: "OK." });

                    await database.payments.deleteCheckoutSession(sessionID);

                    break;

                }

                res.status(200).json({ msg: "OK." });

                invoice = await stripeAPI.invoices.retrieve(event.data.object.invoice)

                charge = invoice.charge;

                const sessionData = await database.payments.getCheckoutSession(sessionID);

                if (!sessionData) {

                    new utils.ErrorHandler("0x000043").throwError();

                }

                await database.payments.addCoursePayment(sessionData.userID, sessionData.item);

                await database.payments.deleteCheckoutSession(sessionID);

                break;

            case "customer.subscription.created":

                const customerID = event.data.object.customer;
                const subID = event.data.object.id;

                res.status(200).json({ msg: "OK." });

                invoice = await stripeAPI.invoices.retrieve(event.data.object.latest_invoice)

                charge = invoice.charge;

                const userID = (await database.users.getUserInfo(customerID, "stripeCustomerID", ["userID"]))[0].userID;

                const currentSubID = await database.payments.getSubID(userID);

                if (currentSubID) {

                    const subscription = await stripe.subscriptions.retrieve(currentSubID);

                    if (subscription.items.data[0].price.id == event.data.object.items.data[0].price.id) {

                        new utils.ErrorHandler("0x000015").throwError();


                    }

                    else {

                        await stripeAPI.subscriptions.cancel(subID);

                    }
                    
                }

                await database.payments.updateSubID(customerID, subID);

                break;


            case "invoice.created":

                invoice = event.data.object
                const invoicePDFURL = invoice.invoice_pdf;

                res.status(200).json({ msg: "OK." });

                await utils.sendEmail(notificationEmailTransport, "Aristotle Academy Payment Invoice", `Your invoice for your recent Aristotle Academy purchase is now available for download here: ${invoicePDFURL}`, email, true, username);

                break;
            
        }

    }

    catch (error) {

        if (charge) {

            await stripeAPI.refunds.create({ charge });

            await utils.sendEmail(notificationEmailTransport, "Aristotle Academy Payment Faliure", "Unfourtunately, your recent Aristotle Academy payment has failed, so the payment has been refunded.", email, true, username);

        }

        if (!res.headersSent) {

            handleRequestError(error, res);

        }

    }

});

app.use(express.json())
app.use(morgan(":date - :client-ip - :user-agent - :method :url"));
app.use(cookieParser());
app.use(getTokenMiddleware);
app.use(requestVerifcationMiddleware)
app.use(indexRouteMiddle);
app.use(ejsRenderMiddleware);

app.set('views', './views');
app.set("view engine", "ejs");

app.use(express.static("assets"));

app.post("/signup", async (req, res) => {

    try {

        const data = req.body;

        const username = data.username;
        const email = data.email;
        const password = data.password;

        const userID = await database.users.addNewUser(username, email, password);

        const jwtToken = await generateToken(username, userID, true);

        res.status(201).cookie("jwt", jwtToken, { httpOnly: true, maxAge: 1000 * 60 * 30 }).json({ msg: "OK." });

    }

    catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/signin", async (req, res) => {

    try {

        const data = req.body;

        const username = data.username;
        const password = data.password;

        if (!(await database.authentication.verifyPassword(username, password))) {

            new utils.ErrorHandler("0x000012").throwError();

            return;

        }

        const userID = (await database.users.getUserInfo(username, "username", ["userID"]))[0].userID;

        await database.authentication.sendMFAEmail(userID);

        const jwtToken = await generateToken(username, userID, true);

        res.status(200).cookie("jwt", jwtToken, { httpOnly: true, maxAge: 1000 * 60 * 30, overwrite: true }).json({ msg: "OK." });

    }

    catch (error) {

        handleRequestError(error, res);

        return;

    }

});

app.get("/signout", async (req, res) => {

    const token = req.headers.auth;

    await database.authorization.deleteJWT(token.userID, token.jwtID);

    res.status(200).clearCookie("jwt").clearCookie("passwordReset").json({ msg: "OK." });

});

app.post("/completeMFA", async (req, res) => {

    try {

        const token = req.headers.auth;

        const code = req.body.code;

        const codeOK = await database.authentication.verifyMFACode(token.userID, code);

        if (codeOK) {

            const jwtToken = await generateToken(token.username, token.userID, false);

            res.status(200).cookie("jwt", jwtToken, { httpOnly: true, maxAge: process.env.JWT_EXPIRES_MS, overwrite: true }).json({ msg: "OK." });

        }

        else {

            new utils.ErrorHandler("0x000013").throwError();

        }

    }

    catch (error) {

        handleRequestError(error, res);

        return;

    }

});

app.use(tokenMFARequiredFilterMiddleware);

app.post("/deleteAccount", async (req, res) => {

    try {

        const token = req.headers.auth;
        const password = req.body.password;

        const username = token.username;
        const userID = token.userID;

        if (!(await database.authentication.verifyPassword(username, password))) {

            new utils.ErrorHandler("0x000012").throwError();

            return;

        }

        await database.users.deleteUser(userID);

        res.status(200).clearCookie("jwt").json({ msg: "OK." });

    }

    catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/changeUserDetails", async (req, res) => {

    try {

        const token = req.headers.auth;

        const data = req.body;

        const username = token.username;
        const password = data.password;

        if (!(await database.authentication.verifyPassword(username, password))) {

            new utils.ErrorHandler("0x000012").throwError();

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

app.post("/sendPasswordResetEmail", async (req, res) => {

    try {

        const data = req.body;

        const userID = (await database.users.getUserInfo(data.val, data.recoveryMethod, ["userID"]))[0]?.userID;

        if (!userID) {

            new utils.ErrorHandler(data.recoveryMethod == "email" ? "0x000047" : "0x000048").throwErrorToClient(res);
            
            return;

        }

        await database.authentication.sendMFAEmail(userID);

        const time = Date.now();

        const salt = crypto.randomBytes(+process.env.SALT_SIZE).toString("base64");

        res.status(200).cookie("passwordReset", { userID: utils.encrypt(userID, "base64"), time, salt, signature: utils.hashHMAC(userID + time.toString() + salt, "base64") }, { httpOnly: true, maxAge: 1000 * 60 * 15, overwrite: true }).json({ msg: "OK." });

    }

    catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/resetPassword", async (req, res) => {

    try {

        const data = req.body;

        const passwordResetCookie = req.cookies.passwordReset;

        if (!passwordResetCookie) {

            new utils.ErrorHandler("0x000044").throwErrorToClient(res);

            return;

        }

        if (!utils.verifyHMAC(utils.decrypt(passwordResetCookie.userID, "base64") + passwordResetCookie.time.toString() + passwordResetCookie.salt, passwordResetCookie.signature, "base64")) {

            new utils.ErrorHandler("0x000044").throwErrorToClient(res);

            return;

        }

        if (passwordResetCookie.time + 1000 * 60 * 15 < Date.now()) {

            new utils.ErrorHandler("0x000045").throwErrorToClient(res);

            return;

        }

        if (!database.authentication.verifyMFACode(utils.decrypt(passwordResetCookie.userID, "base64"), data.code)) {

            new utils.ErrorHandler("0x000046").throwErrorToClient(res);

            return;

        }

        await database.users.changeUserInfo(utils.decrypt(passwordResetCookie.userID, "base64"), "userID", data.newPassword, "password");

        res.status(200).clearCookie("passwordReset").json({ msg: "OK." });

    }

    catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/learnRedirect", async (req, res) => {

    try {

        const token = req.headers.auth;
        const courseID = req.body.courseID;

        if (!courseIDs.includes(courseID)) {

            new utils.ErrorHandler("0x000014").throwError();

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

app.post("/buyRedirect", async (req, res) => {

    try {

        const item = req.body.item;
        const password = req.body.password;

        const token = req.headers.auth;

        if (!(await database.authentication.verifyPassword(token.username, password))) {

            new utils.ErrorHandler("0x000012").throwError();

            return;

        }

        const customerID = (await database.users.getUserInfo(token.userID, "userID", ["stripeCustomerID"]))[0].stripeCustomerID;

        let line_items;

        const subID = await database.payments.getSubID(token.userID);

        switch (item) {

            case "none-sub":

                if (subID) {

                    await stripeAPI.subscriptions.cancel(subID);

                    await database.payments.updateSubID(customerID, "");

                }

                res.status(200).json({ msg : "OK.", url : process.env.DOMAIN_NAME + "/learn" })

                return;

            case "monthly-sub":

                if (subID) {

                    const subscription = await stripeAPI.subscriptions.retrieve(subID)

                    if (subscription.items.data[0].price.id == subIDs.monthly) {

                        new utils.ErrorHandler("0x000015").throwError();


                    }

                }


                line_items = [{ price: subIDs.monthly, quantity: 1 }];

                break;

            case "yearly-sub":

                if (subID) {

                    const subscription = await stripeAPI.subscriptions.retrieve(subID)

                    if (subscription.items.data[0].price.id == subIDs.yearly) {

                        new utils.ErrorHandler("0x000015").throwError();


                    }
                    
                }

                line_items = [{ price: subIDs.yearly, quantity: 1 }]

                break;

            default:

                if (courseIDs.includes(item)) {

                    const paidFor = await database.payments.checkIfPaidFor(token.userID, item);

                    if (paidFor) {

                        new utils.ErrorHandler("0x000015").throwError();

                    }

                    line_items = [{ price: courseData[item].stripe_price_id, quantity: 1 }]

                }

                else {

                    new utils.ErrorHandler("0x000014").throwError();

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

            success_url: process.env.DOMAIN_NAME + "/learn",
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

app.post("/updatePaymentDetails", async (req, res) => {

    const password = req.body.password;

    const token = req.headers.auth;

    if (!(await database.authentication.verifyPassword(token.username, password))) {

        new utils.ErrorHandler("0x000012").throwError();

        return;

    }

    const customerID = (await database.users.getUserInfo(token.userID, "userID", ["stripeCustomerID"]))[0].stripeCustomerID;

    const session = await stripeAPI.checkout.sessions.create({

        customer: customerID,

        success_url: process.env.DOMAIN_NAME + "/account",
        cancel_url: process.env.DOMAIN_NAME + "/account",

        mode: "setup",
        payment_method_types: ["card"],

    });

    res.status(200).json({ msg: "OK.", url: session.url });

});

app.get("/getCourseData", async (req, res) => {

    try {

        const data = req.query;

        const token = req.headers.auth;

        if (!token && data.filter == "true") {

            new utils.ErrorHandler("0x000001").throwError();

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

                res.status(200).json({ msg: "OK.", courseIDs, courseData });

            }

        }

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/verifyHMACSignature", (req, res) => {

    try {

        res.status(200).json({ msg: "OK.", verified: utils.verifyHMAC(req.body.data, req.body.signature, "base64url") })

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/completeLessonChunk", async (req, res) => {

    try {

        const token = req.headers.auth;
        const data = req.body;

        await database.courses.updateLessonIndexes(token.userID, data.courseID, data.lessonNumber, data.lessonChunk + 1);

        const contentID = await ai.getContentID(token.userID, data.courseID);

        res.status(200).json({ msg : "OK.", newURL : `/course?lessonNumber=${data.lessonNumber}&lessonChunk=${data.lessonChunk + 1}&courseID=${data.courseID}&contentID=${contentID}` });

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/completeLesson", async (req, res) => {

    try {

        const token = req.headers.auth;
        const data = req.body;

        await database.courses.updateLessonIndexes(token.userID, data.courseID, data.lessonNumber + 1, 0);

        if (data.lessonNumber + 1 >= courseData[data.courseID].topics.length) {

            res.status(200).json({ msg : "OK.", newURL : `/courseCompleted?courseID=${data.courseID}`});

            return;

        }

        const sessionTimes = await database.courses.getSessionTimes(token.userID, data.courseID)

        const averageSessionTime = (sessionTimes).reduce((acc, elem) => acc + elem) / sessionTimes.length;

        await ai.updateAI(token.userID, data.courseData, data.lessonNumber, data.quizScore, averageSessionTime)

        const contentID = await ai.getContentID(token.userID, data.courseID);

        res.status(200).json({ msg : "OK.", newURL : `/course?lessonNumber=${data.lessonNumber + 1}&lessonChunk=${0}&courseID=${data.courseID}contentID=${contentID}`});

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/logSessionTime", async (req, res) => {

    try {

        const token = req.headers.auth;

        await database.courses.updateSessionTimes(token.userID, req.body.courseID, req.body.sessionTime);

        res.status(200).json({ msg: "OK." });

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.listen(process.env.PORT || 3000, () => {

    console.log(`listening on port ${process.env.PORT || 3000}`);

});