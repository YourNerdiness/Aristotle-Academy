import ai from "./ai.js";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import database from "./database.js"
import dotenv from "dotenv";
import ejs from "ejs";
import express from "express";
import fs from "fs";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import nodemailer from "nodemailer";
import stripe from "stripe";
import utils from "./utils.js";
import path from "path";
import { error } from "console";

const developmentMode = process.argv.includes('-d');

if (developmentMode) {

    console.log("Running in development mode.")

}

dotenv.config({ path: developmentMode ? "./.env.development" : "./.env.prod" });

const pageRoutes = fs.readdirSync("views/pages").map(x => `/${x.split(".")[0]}`);
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

let subIDs, courseData, courseIDs;

const updateConfig = async () => {

    subIDs = await database.config.getConfigData("sub_ids");
    courseData = await database.config.getConfigData("course_data");
    courseIDs = Object.keys(courseData);

};

await updateConfig();

const handleRequestError = (error, res) => {

    if (error.throwErrorToClient) {

        error.throwErrorToClient(res);

    }

    else {

        utils.createLog(error.toString(), "DEFAULT");

        res.status(500).json({ msg: error.toString() });

    }

};

const pageRedirectCallbacks = {

    account: async (req, res) => {

        if (!req.headers.auth || req.headers.auth.mfaRequired) {

            res.status(401).redirect("/signup?redirectError=You are signed out.");

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

        if (!courseIDs.includes(courseID)) {

            res.redirect("/learn?redirectError=Course does not exist.");

            return true;

        }

        if (token && !token.mfaRequired) {

            const accountType = (await database.users.getUserInfo(token.userID, "userID", ["accountType"]))[0].accountType;

            if (accountType == "admin") {

                res.redirect("/purchaseSchoolSub?redirectError=Admins can only purchase school subscriptions.");

                return true;

            }

            if (await database.payments.checkIfPaidFor(token.userID, courseID)) {

                res.redirect(`/course?courseID=${courseID}&redirectError=Course already paid for`)

                return true;

            }

            return false;

        }

        return false;

    },

    course: async (req, res) => {

        const token = req.headers.auth;

        if (!token || token.mfaRequired) {

            res.status(401).redirect("/signup?redirectError=You are signed out.");

            return true;

        }

        const accountType = (await database.users.getUserInfo(token.userID, "userID", ["accountType"]))[0].accountType;

        if (accountType == "admin") {

            res.redirect("/schools?redirectError=Admins cannot access courses.");

            return true;

        }

        if (!req.query.courseID || !courseIDs.includes(req.query.courseID)) {

            res.redirect("/learn?redirectError=Course does not exist.");

            return true;

        }

        const paidFor = await database.payments.checkIfPaidFor(token.userID, req.query.courseID);

        if (!paidFor) {

            res.status(400).redirect(`/getPro?courseID=${req.query.courseID}&redirectError=Course not paid for`);

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

    },

    schools: async (req, res) => {

        const token = req.headers.auth;

        if (!token) {

            return false;

        }

        const isAdmin = (await database.users.getUserInfo(token.userID, "userID", ["accountType"]))[0].accountType == "admin";

        if (isAdmin) {

            if (await database.schools.getSchoolData(token.userID)) {

                res.redirect("/manageSchool?redirectError=School already exists.");

                return true;

            }

        }

        return false;

    },

    manageSchool: async (req, res) => {

        const token = req.headers.auth;

        if (!token) {

            res.status(401).redirect("/signup?redirectError=You are signed out.");

            return true;

        }

        const isAdmin = (await database.users.getUserInfo(token.userID, "userID", ["accountType"]))[0].accountType == "admin";

        if (!isAdmin || !await database.schools.getSchoolData(token.userID)) {

            res.redirect("/schools");

            return true;

        }

        return false;

    },

    purchaseSchoolSub: async (req, res) => {

        const token = req.headers.auth;

        if (!token) {

            res.status(401).redirect("/signup?redirectError=You are signed out.");

            return true;

        }

        const isAdmin = ((await database.users.getUserInfo(token.userID, "userID", ["accountType"]))[0].accountType) == "admin";

        if (!isAdmin) {

            res.redirect("/schools");

            return true;

        }

        if (await database.schools.getSchoolData(token.userID)) {

            res.redirect("/manageSchool");

        }

        return false;

    }

};

const ejsVars = {

    getPro: async (req, res) => {

        return {

            coursePrice: "25 AUD",
            monthlyPrice: "30 AUD",
            yearlyPrice: "60 AUD",
            courseName: courseData[req.query.courseID].title

        }

    },

    account: async (req, res) => {

        let username = "Error in finding username";
        let email = "Error in finding email";
        let accountType = "Error in finding account type";
        let paymentMethod = "No payment method set";
        let subStatus = "None";
        let schoolName = "None";

        const token = req.headers.auth;

        if (!token) {

            username = email = accountType = paymentMethod = subStatus = schoolName = "Please sign in to view your account info";

        }

        else {

            username = token.username;

            const userData = (await database.users.getUserInfo(token.userID, "userID", ["email", "stripeCustomerID", "schoolID"]))[0]

            email = userData.email;

            const stripeCustomerID = userData.stripeCustomerID;

            const paymentMethods = await stripeAPI.customers.listPaymentMethods(stripeCustomerID, { limit: 1 });

            if (paymentMethods.data.length > 0) {

                const last4CardDigits = paymentMethods.data[0].card?.last4;

                paymentMethod = `Card ending in ${last4CardDigits}`

            }

            accountType = (await database.users.getUserInfo(token.userID, "userID", ["accountType"]))[0].accountType;

            accountType = accountType.charAt(0).toUpperCase() + accountType.slice(1);

            let schoolID;

            switch (accountType) {

                case "Individual":

                    const subID = await database.payments.getSubID(token.userID);

                    if (subID) {

                        const subscription = await stripeAPI.subscriptions.retrieve(subID);

                        switch (subscription.items.data[0].price.id) {

                            case subIDs.monthly:

                                subStatus = "Monthly";

                                break;

                            case subIDs.yearly:

                                subStatus = "Yearly";

                                break;

                        }

                    }

                    const stripeCustomerID = userData.stripeCustomerID;

                    const paymentMethods = await stripeAPI.customers.listPaymentMethods(stripeCustomerID, { limit: 1 });

                    if (paymentMethods.data.length > 0) {

                        const last4CardDigits = paymentMethods.data[0].card?.last4;

                        paymentMethod = `Card ending in ${last4CardDigits}.`


                    }

                    break;

                case "Student":

                    schoolID = userData.schoolID;

                    if (schoolID) {

                        const schoolData = await database.schools.getSchoolDataBySchoolID(schoolID);

                        const userIDHash = utils.hash(token.userID, "base64")

                        if (schoolData) {

                            if (schoolData.studentUserIDs.reduce((acc, elem) => { return acc || (userIDHash == elem) }, false)) {

                                schoolName = utils.decrypt(schoolData.schoolName, "utf-8");

                                if (schoolData.schoolSubID.content) {

                                    paymentMethod = utils.decrypt(schoolData.schoolName, "utf-8")

                                    const subscription = await stripeAPI.subscriptions.retrieve(utils.decrypt(schoolData.schoolSubID, "utf-8"));

                                    if (subscription.status == "active") {

                                        subStatus = "School"

                                    }

                                    else {

                                        subStatus = "School (subscription inactive, please contact your school's admin)"

                                    }

                                }

                                else {

                                    subStatus = "School (no subscription, please contact your school's admin)"

                                }

                            }

                        }

                    }

                    break;

                case "Admin":

                    const adminUserID = token.userID;

                    schoolID = utils.decrypt((await database.schools.getSchoolData(adminUserID))?.schoolID, "base64");

                    if (schoolID) {

                        const schoolDataResults = await database.schools.getSchoolData(adminUserID);

                        if (schoolDataResults.length > 1) {

                            new utils.ErrorHandler("0x000032").throwError();

                        }

                        else if (schoolDataResults.length == 1) {

                            const schoolData = schoolDataResults[0];

                            const subscription = await stripeAPI.subscriptions.retrieve(utils.decrypt(schoolData.schoolSubID, "utf-8"));

                            if (subscription.status == "active") {

                                subStatus = "To manage school subscription, please go the manage school page."

                            }

                            const stripeCustomerID = userData.stripeCustomerID;

                            const paymentMethods = await stripeAPI.customers.listPaymentMethods(stripeCustomerID, { limit: 1 });

                            if (paymentMethods.data.length == 0) {

                                paymentMethod = "No payment method set"

                            }

                            else {

                                const last4CardDigits = paymentMethods.data[0].card?.last4;

                                paymentMethod = `Card ending in ${last4CardDigits}`


                            }

                            break;

                        }

                    }

            }

        }

        return {

            username,
            email,
            paymentMethod,
            subStatus,
            accountType,
            schoolName

        }

    },

    courseCompleted: async (req, res) => {

        return {

            courseName: courseData[req.query.courseID].title

        }

    },

    purchaseSchoolSub: async (req, res) => {

        return {

            price100Students: "100 students - 5,700 AUD (5% off)",
            price200Students: "200 students - 10,800 AUD (10% off)",
            price300Students: "300 students - 15,300 AUD (15% off)",
            price400Students: "400 students - 19,200 AUD (20% off)",
            price500Students: "500 students - 22,500 AUD (25% off)",
            price600Students: "600 students - 25,200 AUD (30% off)",
            price700Students: "700 students - 27,300 AUD (35% off)",
            price800Students: "800 students - 28,800 AUD (40% off)",
            price900Students: "900 students - 29,700 AUD (45% off)",
            price1000Students: "1000 students - 30,000 AUD (50% off)"

        }

    },

    manageSchool: async (req, res) => {

        let schoolName = "Error in finding school name";
        let accessCode = "Error in finding access code";
        let subType = "Error in finding access subscription type";

        const token = req.headers.auth;

        if (!token) {

            schoolName = accessCode = subType = "Please sign in to view your school's info";

        }

        else {

            const schoolData = await database.schools.getSchoolData(token.userID);

            if (!schoolData) {

                schoolName = accessCode = subType = "No school exists for this account";

            }

            else {

                schoolName = utils.decrypt(schoolData.schoolName, "utf-8");
                accessCode = utils.decrypt(schoolData.accessCode, "hex");

                const subID = utils.decrypt(schoolData.schoolSubID, "utf-8");

                if (!subID) {

                    subType = "No school subscription"
                }

                else {

                    const subscription = await stripeAPI.subscriptions.retrieve(subID);

                    if (subscription?.status == "active") {

                        for (let maxNumStudents = 100; maxNumStudents <= 1000; i += 100) {

                            if (subIDs[`school${maxNumStudents}`] == subscription?.items?.data[0]?.plan?.id) {

                                subType = `Subscription for ${maxNumStudents} students`

                                break;

                            }

                        }

                    }

                    else {

                        subType = "No school subscription"

                    }

                }

            }

        }

        return {

            schoolName,
            accessCode,
            subType

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

        const decryptedToken = { username: utils.decrypt(encryptedToken.username, "utf-8"), userID: utils.decrypt(encryptedToken.userID, "base64"), jwtID: utils.decrypt(encryptedToken.jwtID, "base64"), mfaRequired: encryptedToken.mfaRequired }

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

const requestVerificationMiddleware = async (req, res, next) => {

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

        if (requestParameters[req.url].allowedAccountTypes) {

            const accountType = (await database.users.getUserInfo(token.userID, "userID", ["accountType"]))[0].accountType;

            if (!requestParameters[req.url].allowedAccountTypes.includes(accountType)) {

                new utils.ErrorHandler("0x00005A", `Account type must be one of ${requestParameters[req.url].allowedAccountTypes.toString()}`).throwErrorToClient(res);

                return;

            }

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

                    if (data[expectedRequestBodyParameters[i]] <= expectedRequestBodyData[expectedRequestBodyParameters[i]].minimumValue) {

                        new utils.ErrorHandler("0x000009").throwErrorToClient(res);

                    }

                }

                if (expectedRequestBodyData[expectedRequestBodyParameters[i]].maximumValue) {

                    if (data[expectedRequestBodyParameters[i]] >= expectedRequestBodyData[expectedRequestBodyParameters[i]].maximumValue) {

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

                    if (data[expectedRequestQueryParameters[i]] <= expectedRequestQueryData[expectedRequestQueryParameters[i]].minimumValue) {

                        new utils.ErrorHandler("0x00000F").throwErrorToClient(res);

                    }

                }

                if (expectedRequestQueryData[expectedRequestQueryParameters[i]].maximumValue) {

                    if (data[expectedRequestQueryParameters[i]] >= expectedRequestQueryData[expectedRequestQueryParameters[i]].maximumValue) {

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

    try {

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

            let navVars = {

                accountRoute: req.headers.auth ? "/account" : "/signup",
                accountText: req.headers.auth ? "Account" : "Signup"

            };

            if (req.headers.auth) {

                const accountType = (await database.users.getUserInfo(req.headers.auth.userID, "userID", ["accountType"]))[0].accountType;

                navVars.learnRoute = accountType == "admin" ? "/manageSchool" : "/learn"
                navVars.learnText = accountType == "admin" ? "Manage" : "Learn"

            }

            else {

                navVars.learnRoute = "/learn"
                navVars.learnText = "Learn"

            }

            res.status(200).render("main", Object.assign({ pageName, bodyPath }, navVars, pageVars, additionalHTML));

        }

        else {

            next();

        }

    }

    catch (error) {

        new utils.ErrorHandler("0x000056", error.userMsg || error.msg || error.toString())

        res.redirect("/error.html")

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

    res.status(200).json({ msg: "OK." });

    const customerID = event.data.object.customer;

    const metadata = event.data.object.metadata;

    let charge, newSubscription, email, username, userID, accountType;

    try {

        ({ email, username, userID, accountType } = (await database.users.getUserInfo(customerID, "stripeCustomerID", ["email", "username", "userID", "accountType"]))[0]);

        switch (event.type) {

            case "checkout.session.completed":

                if (event.data.object.mode == "subscription") {

                    const invoice = await stripeAPI.invoices.retrieve(event.data.object.invoice);

                    charge = invoice.charge;

                    const subID = event.data.object.subscription;

                    newSubscription = await stripeAPI.subscriptions.retrieve(subID);

                    if (accountType == "individual") {

                        const currentSubID = await database.payments.getSubID(userID);

                        if (currentSubID) {

                            const subscription = await stripeAPI.subscriptions.retrieve(currentSubID);

                            if (subscription.items.data[0].price.id == event.data.object.items.data[0].price.id) {

                                new utils.ErrorHandler("0x000015").throwError();


                            }

                            else {

                                await stripeAPI.subscriptions.cancel(subID);

                            }

                        }

                        await database.payments.updateSubID(customerID, subID);

                    }

                    else if (accountType == "admin") {

                        const currentSubID = utils.decrypt((await database.schools.getSchoolData(userID)).schoolSubID);

                        if (currentSubID) {

                            const subscription = await stripeAPI.subscriptions.retrieve(currentSubID);

                            if (subscription.status == "active" && subscription.items.data[0].price.id == event.data.object.items.data[0].price.id) {

                                new utils.ErrorHandler("0x000015").throwError();


                            }

                            else {

                                await database.schools.updateSchoolSubID(userID, subID, Number(metadata.maxNumStudents));

                                await stripeAPI.subscriptions.cancel(currentSubID);

                            }

                        }

                        else {

                            await database.schools.updateSchoolSubID(userID, subID, Number(metadata.maxNumStudents))

                        }

                    }

                    else {

                        new utils.ErrorHandler("0x00004A").throwError();

                    }

                }

                else if (event.data.object.mode == "payment") {

                    const invoice = await stripeAPI.invoices.retrieve(event.data.object.invoice)

                    charge = invoice.charge;

                    await database.payments.addCoursePayment(userID, metadata.item, "utf-8");

                }

                else {

                    new utils.ErrorHandler("0x00004D").throwError();

                }

                break;

            case "invoice.created":

                const invoice = event.data.object
                const invoicePDFURL = invoice.invoice_pdf;

                await utils.sendEmail(notificationEmailTransport, "Aristotle Academy Payment Invoice", `Your invoice for your recent Aristotle Academy purchase is now available for download here: ${invoicePDFURL}`, email, true, username);

                break;

        }

    }

    catch (error) {

        try {

            if (!(error instanceof utils.ErrorHandler)) {

                new utils.ErrorHandler("0x000000", error);

            }

            if (event.type == "checkout.session.completed" && email) {

                if (charge) {

                    await stripeAPI.refunds.create({ charge });

                    await utils.sendEmail(notificationEmailTransport, "Aristotle Academy Payment Failure", "Unfortunately, your recent Aristotle Academy payment has failed, so the payment has been refunded.", email, true, username);

                }

                else {

                    await utils.sendEmail(notificationEmailTransport, "Aristotle Academy Payment Failure", "Unfortunately, your recent Aristotle Academy payment has failed. We tried to refund it, but there was an error in doing so. Please contact support at contact@aristotle.academy.", email, true, username);

                }

                if (newSubscription) {

                    await stripeAPI.subscriptions.cancel(newSubscription.id);

                }

            }

            if (!res.headersSent) {

                handleRequestError(error, res);

            }

        }

        catch (error) {

            new utils.ErrorHandler("0x000057", error)

        }

    }

});

app.use(express.json());
app.use(morgan(":date - :client-ip - :user-agent - :method :url"));
app.use(cookieParser());
app.use(getTokenMiddleware);
app.use(requestVerificationMiddleware)
app.use(indexRouteMiddle);
app.use(ejsRenderMiddleware);

app.set('views', './views');
app.set("view engine", "ejs");

app.use(express.static("assets"));
app.use(express.static("static"));

app.post("/signup", async (req, res) => {

    try {

        const data = req.body;

        const username = data.username;
        const email = data.email;
        const password = data.password;
        const accountType = data.accountType;

        const userID = await database.users.addNewUser(username, email, password, accountType);

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

        await updateConfig();


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

        await updateConfig();

        const data = req.body;

        const item = data.item;
        const password = data.password;

        const token = req.headers.auth;

        const accountType = (await database.users.getUserInfo(token.userID, "userID", ["accountType"]))[0].accountType;

        if (accountType == "student") {

            new utils.ErrorHandler("0x000049", "Student accounts cannot make purchases.").throwError();

        }

        if ((item.slice(0, 6) != "school" && item != "none") && accountType == "admin") {

            new utils.ErrorHandler("0x000049", "Admin accounts cannot make non-school purchases.").throwError();

        }

        if (!(await database.authentication.verifyPassword(token.username, password))) {

            new utils.ErrorHandler("0x000012").throwError();

            return;

        }

        const customerID = (await database.users.getUserInfo(token.userID, "userID", ["stripeCustomerID"]))[0].stripeCustomerID;

        const metadata = {};

        let line_items;

        const subID = await database.payments.getSubID(token.userID);

        switch (item) {

            case "none-sub":

                if (accountType == "individual") {

                    if (subID) {

                        await stripeAPI.subscriptions.cancel(subID);

                        await database.payments.updateSubID(customerID, "");

                    }

                }

                // because student accounts are disallowed, this else statement will run only for admin accounts

                else {

                    const schoolData = await database.schools.getSchoolData(token.userID);

                    const schoolSubId = utils.decrypt(schoolData.subID, "utf-8");

                    if (schoolSubId) {

                        await stripeAPI.subscriptions.cancel(schoolSubId);

                        await database.schools.updateSchoolSubID(token.userID, "");

                    }

                    res.status(200).json({ msg: "OK." });

                    return;

                }

                res.status(200).json({ msg: "OK.", url: process.env.DOMAIN_NAME + "/learn" })

                return;

            case "monthly-sub":

                if (subID) {

                    const subscription = await stripeAPI.subscriptions.retrieve(subID)

                    if (subscription.status == "active" && subscription.items.data[0].price.id == subIDs.monthly) {

                        new utils.ErrorHandler("0x000015").throwError();


                    }

                }


                line_items = [{ price: subIDs.monthly, quantity: 1 }];

                break;

            case "yearly-sub":

                if (subID) {

                    const subscription = await stripeAPI.subscriptions.retrieve(subID)

                    if (subscription.status == "active" && subscription.items.data[0].price.id == subIDs.yearly) {

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

                    metadata.item = item

                    line_items = [{ price: courseData[item].stripe_price_id, quantity: 1 }]

                }

                else if (/^school(10|[1-9])00$/.test(item)) {

                    if (accountType != "admin") {

                        new utils.ErrorHandler("0x000049").throwError();

                    }

                    const schoolData = await database.schools.getSchoolData(token.userID);

                    if (schoolData?.schoolSubID?.content) {

                        const subscription = await stripeAPI.subscriptions.retrieve(utils.decrypt(schoolData.schoolSubID, "utf-8"));

                        if (subscription.status == "active" && subscription.items.data[0].price.id == subIDs[item]) {

                            new utils.ErrorHandler("0x000015").throwError();

                        }


                    }

                    if (!schoolData) {

                        if (!data.ipAddr) {

                            new utils.ErrorHandler("0x000006").throwError();
    
                        }
    
                        if (!data.schoolName) {
    
                            new utils.ErrorHandler("0x000006").throwError();
    
                        }

                        await database.schools.createSchool(token.userID, data.schoolName, Number(item.substring(6)), data.ipAddr);
                        
                    }

                    metadata.maxNumStudents = item.substring(6);

                    line_items = [{ price: subIDs[item], quantity: 1 }];

                }

                else {

                    new utils.ErrorHandler("0x000014").throwError();

                    return;

                }

                break;

        }

        const session = await stripeAPI.checkout.sessions.create({

            metadata,

            customer: customerID,

            success_url: process.env.DOMAIN_NAME + (item.slice(0, 6) == "school" ? "/manageSchool" : "/learn"),
            cancel_url: process.env.DOMAIN_NAME + (item.slice(0, 6) == "school" ? "/purchaseSchoolSub" : "/getPro"),

            currency: "aud",
            mode: (item.slice(-3) == "sub" || item.slice(0, 6) == "school") ? "subscription" : "payment",
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

        await updateConfig();

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

app.post("/joinSchool", async (req, res) => {

    try {

        const token = req.headers.auth;
        const data = req.body;

        const schoolData = await database.schools.getSchoolDataByAccessCode(data.accessCode);

        if (!schoolData) {

            new utils.ErrorHandler("0x00004F").throwError();

        }

        const schoolIpAddr = utils.decrypt(schoolData.ipAddr, "utf-8");

        if (!developmentMode && req.ip != schoolIpAddr) {

            new utils.ErrorHandler("0x000051").throwError();

        }

        const userID = token.userID;
        const userIDHash = utils.hash(userID, "base64");

        if (schoolData.studentUserIDs.includes(userIDHash)) {

            new utils.ErrorHandler("0x000052").throwError();

        }

        if (schoolData.studentUserIDs.length > Number(utils.decrypt(schoolData.maxNumStudents, "utf-8"))) {

            new utils.ErrorHandler("0x000050").throwError();

        }

        const schoolID = (await database.users.getUserInfo(userID, "userID", ["schoolID"]))[0].schoolID;

        if (schoolID) {

            const schoolData = await database.schools.getSchoolDataBySchoolID(schoolID);

            if (schoolData) {

                const adminUserID = utils.decrypt(schoolData.adminUserID, "base64");

                await database.schools.removeStudent(adminUserID, userID);

            }

        }

        await database.schools.addStudent(utils.decrypt(schoolData.adminUserID, "base64"), userID);

        res.status(200).json({ msg: "OK." });

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/leaveSchool", async (req, res) => {

    try {

        const token = req.headers.auth;

        const { schoolID } = (await database.users.getUserInfo(token.userID, "userID", ["schoolID"]))[0];

        const schoolData = await database.schools.getSchoolDataBySchoolID(schoolID);

        if (!schoolData) {

            new utils.ErrorHandler("0x000054").throwError();

        }

        const adminUserID = utils.decrypt(schoolData.adminUserID, "base64");

        await database.schools.removeStudent(adminUserID, token.userID);

        res.status(200).json({ msg: "OK." });

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.get("/getSchoolStudentList", async (req, res) => {

    try {

        const token = req.headers.auth;

        const schoolData = await database.schools.getSchoolData(token.userID);

        if (!schoolData) {

            new utils.ErrorHandler("0x00005B").throwError();

        }

        const studentUserDataPromiseArr = [];

        for (let i = 0; i < schoolData.studentUserIDs.length; i++) {

            studentUserDataPromiseArr.push(database.users.getUserInfo(schoolData.studentUserIDs[i], "userID", ["username"], true));

        }

        const resolvedStudentDataPromiseArr = await Promise.all(studentUserDataPromiseArr);

        const studentUsernames = resolvedStudentDataPromiseArr.map((val) => { return val[0]?.username });

        res.status(200).json({ msg: "OK.", studentUsernames });

    }

    catch (error) {

        handleRequestError(error, res)

    }

});

app.post("/adminDeleteSchoolStudent", async (req, res) => {

    try {
        
        const token = req.headers.auth;

        const data = req.body;

        const studentUsername = data.studentUsername;

        const studentUserDataResults = await database.users.getUserInfo(studentUsername, "username", ["userID"]);

        if (studentUserDataResults.length == 0) {

            new utils.ErrorHandler("0x00005C").throwError();

            return;

        }

        await database.schools.removeStudent(token.userID, studentUserDataResults[0].userID);

        res.status(200).json({ msg : "OK." });

    }

    catch (error) {

        handleRequestError(error, res)

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

        res.status(200).json({ msg: "OK.", newURL: `/course?lessonNumber=${data.lessonNumber}&lessonChunk=${data.lessonChunk + 1}&courseID=${data.courseID}&contentID=${contentID}` });

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/completeLesson", async (req, res) => {

    try {

        await updateConfig();

        const token = req.headers.auth;
        const data = req.body;

        await database.courses.updateLessonIndexes(token.userID, data.courseID, data.lessonNumber + 1, 0);

        if (data.lessonNumber + 1 >= courseData[data.courseID].topics.length) {

            res.status(200).json({ msg: "OK.", newURL: `/courseCompleted?courseID=${data.courseID}` });

            return;

        }

        const sessionTimes = await database.courses.getSessionTimes(token.userID, data.courseID)

        const averageSessionTime = (sessionTimes).reduce((acc, elem) => acc + elem) / sessionTimes.length;

        await ai.updateAI(token.userID, data.courseData, data.lessonNumber, data.quizScore, averageSessionTime)

        const contentID = await ai.getContentID(token.userID, data.courseID);

        res.status(200).json({ msg: "OK.", newURL: `/course?lessonNumber=${data.lessonNumber + 1}&lessonChunk=${0}&courseID=${data.courseID}contentID=${contentID}` });

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.post("/getLessonChunkContent", async (req, res) => {

    try {

        const token = req.headers.auth;

        const courseID = req.body.courseID;
        const contentID = req.body.contentID;

        const contentIDParts = contentID.split("|");

        const verified = utils.verifyHMAC(contentIDParts[0], contentIDParts[1], "base64url");

        if (!verified) {

            new utils.ErrorHandler("0x00005E").throwError();

            return;

        }

        const paidFor = await database.payments.checkIfPaidFor(token.userID, courseID);

        if (!paidFor) {

            new utils.ErrorHandler("0x00005D").throwError();

            return;

        }

        const courseContentRes = await fetch("https://coursecontent.aristotle.academy" + contentIDParts[0]);

        console.log("https://coursecontent.aristotle.academy" + contentIDParts[0])

        if (!courseContentRes.ok) {

            console.log(await courseContentRes.text())

            new utils.ErrorHandler("0x00005F").throwError();

            return;

        }

        else {

            res.status(200).json({ msg : "OK.", data : await courseContentRes.text() })

        }

    }

    catch (error) {


        
    }

});

app.post("/logSessionTime", async (req, res) => {

    try {

        const token = req.headers.auth;
        0x00005D
        await database.courses.updateSessionTimes(token.userID, req.body.courseID, req.body.sessionTime);

        res.status(200).json({ msg: "OK." });

    } catch (error) {

        handleRequestError(error, res);

    }

});

app.listen(process.env.PORT || 3000, () => {

    console.log(`listening on port ${process.env.PORT || 3000}`);

});