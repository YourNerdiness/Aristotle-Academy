import crypto from "crypto"
import dotenv from "dotenv"
import fs, { access } from "fs"
import { ListCollectionsCursor, MongoClient, ServerApiVersion } from "mongodb"
import nodemailer from "nodemailer"
import process from "process"
import stripe from "stripe"
import utils from "./utils.js"
import redis from "redis"

const developmentMode = process.argv.includes('-d');

dotenv.config({ path: developmentMode ? "./.env.development" : "./.env.prod" });

const stripeAPI = stripe(process.env.STRIPE_SK);

const mongodbURI = `mongodb+srv://${encodeURIComponent(process.env.MONGODB_USERNAME)}:${encodeURIComponent(process.env.MONGODB_PASSWORD)}@${encodeURIComponent(process.env.MONGODB_HOSTNAME)}/?retryWrites=true&w=majority`;

const mongoClient = new MongoClient(mongodbURI, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

await mongoClient.connect();

const db = mongoClient.db(process.env.MONGODB_DB_NAME);

const collections = {

    users : db.collection("users"),
    payments : db.collection("payments"),
    authentication : db.collection("authentication"),
    jwts : db.collection("jwts"), 
    courses : db.collection("courses"),
    ai : db.collection("ai"),
    schools : db.collection("schools"),
    config : db.collection("config")
    
};

await collections.jwts.createIndex({ createdAt: 1 }, { expireAfterSeconds: (+process.env.JWT_EXPIRES_MS)/1000 });

const redisClient = redis.createClient({

    password: process.env.REDIS_PASSWORD,
    socket: {

        host: process.env.REDIS_HOSTNAME,
        port: 12978

    }

});

redisClient.on("error", err => new utils.ErrorHandler("0x000000", err).throwError() );

await redisClient.connect();

const courseData = await (async (name) => {

    const results = await collections.config.find({ name }).toArray();

    if (results.length == 0) {

        new utils.ErrorHandler("0x000018").throwError();

    }

    else if (results.length > 1) {

        new utils.ErrorHandler("0x000019").throwError();

    }

    else {

        return results[0].data;

    }

})(`${developmentMode ? "dev_" : ""}course_data`);

const courseIDs = Object.keys(courseData);
const defaultCourseData = courseIDs.reduce((obj, key) => {

    obj[key] = { currentLessonNumber : 0, currentLessonChunk : 0, sessionTimes : [], chunkContentTypes : [] };

    return obj;

}, {});
const defaultCoursePaymentData = courseIDs.reduce((obj, key) => {

    obj[key] = false;

    return obj;

}, {});

const authEmailTransport = nodemailer.createTransport({
    service: "gmail",
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
        user: process.env.AUTH_EMAIL_ADDRESS,
        pass: process.env.AUTH_EMAIL_APP_PASSWORD
    },
});

const propertyEncodings = {

    userID : "base64",
    stripeCustomerID : "utf-8",
    username : "utf-8",
    email : "utf-8",
    passwordDigest : "base64",
    passwordSalt : "base64",
    subID : "utf-8",
    accountType : "utf-8",
    schoolID : "base64",
    courses : "object"
}

const userDataProperties = ["userID", "stripeCustomerID", "username", "email", "passwordDigest", "passwordSalt", "accountType", "schoolID"]
const userIndexProperties = ["username", "email", "userID", "stripeCustomerID"]; // placing a property here will mandate it's uniqueness amongst relevant documents
const paymentDataProperties = ["subID", "courses", "schoolID"]
const paymentIndexProperties = ["userID", "stripeCustomerID"]; // placing a property here will mandate it's uniqueness amongst relevant documents

const allProperties = Array.from(new Set([...userDataProperties, ...userIndexProperties, ...paymentDataProperties, ...paymentIndexProperties]));

const passwordCheckStatuses = JSON.parse(fs.readFileSync("password_check_statuses.json"));

const users = {

    addNewUser: async (username, email, password, accountType="individual") => {

        if (!["individual", "student", "admin"].includes(accountType)) {

            new utils.ErrorHandler("0x00003C").throwError();

            return;

        }

        let userID = crypto.randomBytes(256).toString("base64");

        let userIDResults = await users.getUserInfo(userID, "userID", ["userID"]);
        const usernameResults = await users.getUserInfo(username, "username", ["userID"]);
        const emailResults = await users.getUserInfo(email, "email", ["userID"]);
        
        while (userIDResults.length > 0) {

            userID = crypto.randomBytes(256).toString("base64");

            userIDResults = await users.getUserInfo(userID, "userID", ["userID"]);

        }

        if (usernameResults.length > 0) {

            new utils.ErrorHandler("0x00001A").throwError();

        }

        if (emailResults.length > 0) {

            new utils.ErrorHandler("0x00001B").throwError();

        }

        const passwordStatus = await utils.checkNewPassword(password);

        if (passwordStatus != 0) {

            new utils.ErrorHandler("0x00001C", passwordCheckStatuses[passwordStatus] || "Password is invalid.").throwError();

        }

        let customer;

        try {

            customer = await stripeAPI.customers.create({

                name: username,
                email

            });

        } catch (error) {

            switch (error.raw.code) {

                case "email_invalid":

                    new utils.ErrorHandler("0x00001D", "Email is invalid.").throwError();

                default:

                    new utils.ErrorHandler("0x00001E", error.raw.message).throwError();

            }

        }

        const passwordSalt = crypto.randomBytes(+process.env.SALT_SIZE).toString("base64");

        const allData = {

            userID,
            accountType,
            stripeCustomerID: customer.id,
            username,
            email,
            passwordDigest : utils.passwordHash(password + process.env.PASSWORD_PEPPER, passwordSalt, 64).toString("base64"),
            passwordSalt,
            subID : "",
            schoolID : "",
            courses : defaultCoursePaymentData

        };

        if (Object.keys(allData).reduce((hasInvalidProperty, propertyName) => { return hasInvalidProperty || !allProperties.includes(propertyName) }, false)) {

            new utils.ErrorHandler("0x00001F", "Unexpected property exists in allData.").throwError();

        }

        if (allProperties.reduce((hasInvalidProperty, propertyName) => { return hasInvalidProperty || !Object.keys(allData).includes(propertyName) }, false)) {

            new utils.ErrorHandler("0x00001F", "Missing property in allData.").throwError();

        }

        const userData = Object.keys(allData).filter(key => userDataProperties.includes(key)).reduce((obj, key) => {

            obj[key] = utils.encrypt(allData[key], propertyEncodings[key] || new utils.ErrorHandler("0x000020", `Encoding information missing for ${key}`).throwError());

            return obj;

        }, {});

        const userIndex = Object.keys(allData).filter(key => userIndexProperties.includes(key)).reduce((obj, key) => {

            obj[key] = utils.hash(allData[key], propertyEncodings[key] || new utils.ErrorHandler("0x000020", `Encoding information missing for ${key}`).throwError());

            return obj;

        }, {});

        const paymentData = Object.keys(allData).filter(key => paymentDataProperties.includes(key)).reduce((obj, key) => {

            obj[key] = utils.encrypt(allData[key], propertyEncodings[key] || new utils.ErrorHandler("0x000020", `Encoding information missing for ${key}`).throwError());

            return obj;

        }, {});

        const paymentIndex = Object.keys(allData).filter(key => paymentIndexProperties.includes(key)).reduce((obj, key) => {

            obj[key] = utils.hash(allData[key], propertyEncodings[key] || new utils.ErrorHandler("0x000020", `Encoding information missing for ${key}`).throwError());

            return obj;

        }, {});

        const userDocument = {

            data : userData,
            index : userIndex

        };

        const paymentDocument = {

            data : paymentData,
            index : paymentIndex

        };

        const userIDHash = utils.hash(userID, "base64");

        const emailVerifcationCode = crypto.randomBytes(6).toString("hex");

        const welcomeEmailContent = `Welcome to Aristotle Academy, we hope you'll benefit from our service. Here is your code to verify your email: <br> <h5>${emailVerifcationCode}</h5>`;

        utils.sendEmail(authEmailTransport, "Welcome to Aristotle Academy!", welcomeEmailContent, email, true, username);

        const session = mongoClient.startSession();

        await session.withTransaction(async () => {

            await collections.users.insertOne(userDocument);
            await collections.payments.insertOne(paymentDocument);

            await collections.courses.insertOne({

                userIDHash,
                courseData: defaultCourseData,
                completedTopics: []

            });

            await collections.ai.insertOne({ userIDHash, numChunks: 6 });

            await collections.authentication.insertOne({

                userIDHash,
                code: utils.encrypt(emailVerifcationCode, "hex"),
                timestamp: Date.now()

            });

        });

        return userID;

    },

    getUserInfo: async (query, queryPropertyName, resultPropertyNames, queryIsAlreadyHashed=false) => {

        if (!userIndexProperties.includes(queryPropertyName)) {

            new utils.ErrorHandler("0x000021", `${queryPropertyName} does not exist in the user index.`).throwError();

        }

        const nonexistantResultPropertyNames = resultPropertyNames.filter((resultPropertyName) => !userDataProperties.includes(resultPropertyName))

        if (nonexistantResultPropertyNames.length > 0) {

            new utils.ErrorHandler("0x000029", `${nonexistantResultPropertyNames[0]} does not exist in the user data.`).throwError();

        }

        if (!propertyEncodings[queryPropertyName]) {

            new utils.ErrorHandler("0x000020", `Encoding information missing for ${queryPropertyName}`).throwError();

        }

        const missingEncodingPropertyNames = resultPropertyNames.filter((resultPropertyName) => !(Object.keys(propertyEncodings)).includes(resultPropertyName));

        if (missingEncodingPropertyNames.length > 0) {

            new utils.ErrorHandler("0x000020", `Encoding information missing for ${missingEncodingPropertyNames[0]}`).throwError();

        }

        const projection = resultPropertyNames.reduce((obj, resultPropertyName) => {

            obj[`data.${resultPropertyName}`] = 1;
            
            return obj;

        }, {}); 

        const results = await collections.users.find({ [`index.${queryPropertyName}`]: queryIsAlreadyHashed ? query : utils.hash(query, propertyEncodings[queryPropertyName]) }, { projection } ).toArray();

        const usersData = results.map((userData) => {

                const decryptedUserData = Object.keys(userData.data).reduce((obj, key) => { 
                
                        obj[key] = utils.decrypt(userData.data[key], propertyEncodings[key] || new utils.ErrorHandler("0x000020", `Encoding information missing for ${key}`).throwError());
                
                        return obj;
                    
                    }, {});
    
                return decryptedUserData;

            });

        return usersData;

    },

    changeUserInfo: async (query, queryPropertyName, toChangeValue, toChangePropertyName) => {

        const results = await users.getUserInfo(query, queryPropertyName, ["userID"]);

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032", `Multiple users with the same ${queryPropertyName} exist .`).throwError();

        }

        else {

            const userData = results[0];

            const userIDHash = utils.hash(userData.userID, propertyEncodings["userID"]);

            if (toChangePropertyName == "password") {

                const passwordStatus = await utils.checkNewPassword(toChangeValue);

                if (passwordStatus != 0) {

                    new utils.ErrorHandler("0x00003B", passwordCheckStatuses[passwordStatus] || "Password is invalid.").throwError();

                }

                const passwordSalt = crypto.randomBytes(+process.env.SALT_SIZE).toString("base64");

                const passwordDigest = utils.passwordHash(toChangeValue + process.env.PASSWORD_PEPPER, passwordSalt, 64).toString("base64");

                await collections.users.updateOne({ "index.userID" : userIDHash }, { $set: { 

                    "data.passwordDigest" : utils.encrypt(passwordDigest, propertyEncodings["passwordDigest"]), 
                    "data.passwordSalt" : utils.encrypt(passwordSalt, propertyEncodings["passwordSalt"])

                }});
                
                return;

            }

            if (!userDataProperties.includes(toChangePropertyName) || toChangePropertyName == "userID") {

                new utils.ErrorHandler("0x000029", "Property either does not exist or is not allowed to be changed.").throwError();

            }

            const session = mongoClient.startSession();

            await session.withTransaction(async () => {

                if (userIndexProperties.includes(toChangePropertyName)) {

                    if ((await (collections.users.find({ [`index.${toChangePropertyName}`]: utils.hash(toChangeValue, propertyEncodings[toChangePropertyName] || new utils.ErrorHandler("0x000020", `Encoding information missing for ${toChangePropertyName}`).throwError()) })).toArray()).length > 0) {

                        new utils.ErrorHandler("0x000033", `The same ${toChangePropertyName} already has an account associated with it.`).throwError();

                    }

                    await collections.users.updateOne({ [`index.${queryPropertyName}`]: utils.hash(query, propertyEncodings[queryPropertyName] || new utils.ErrorHandler("0x000020", `Encoding information missing for ${toChangePropertyName}`).throwError()) }, { $set: { [`index.${toChangePropertyName}`]: utils.hash(toChangeValue, propertyEncodings[toChangePropertyName] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${toChangePropertyName}`).throwError()) } })

                }

                if (paymentIndexProperties.includes(toChangePropertyName)) {

                    if ((await (collections.payments.find({ [`index.${toChangePropertyName}`]: utils.hash(toChangeValue, propertyEncodings[toChangePropertyName] || new utils.ErrorHandler("0x000020", `Encoding information missing for ${toChangePropertyName}`).throwError()) })).toArray()).length > 0) {

                        new utils.ErrorHandler("0x000033 ", `The same ${toChangePropertyName} already has an account associated with it.`).throwError();

                    }

                    await collections.users.updateOne({ [`index.${queryPropertyName}`]: utils.hash(query, propertyEncodings[queryPropertyName] || new utils.ErrorHandler("0x000020", `Encoding information missing for ${toChangePropertyName}`).throwError()) }, { $set: { [`index.${toChangePropertyName}`]: utils.hash(toChangeValue, propertyEncodings[toChangePropertyName] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${toChangePropertyName}`).throwError()) } })

                }

                await collections.users.updateOne({ "index.userID": userIDHash }, { $set: { [`data.${toChangePropertyName}`]: utils.encrypt(toChangeValue, propertyEncodings[toChangePropertyName] || new utils.ErrorHandler("0x000020", `Encoding information missing for ${toChangePropertyName}`).throwError()) } });

            });

        }

    },

    deleteUser : async (userID) => {

        const userIDHash = utils.hash(userID, "base64");
        const { stripeCustomerID, accountType, schoolID } = (await users.getUserInfo(userID, "userID", ["stripeCustomerID", "accountType", "schoolID"]))[0];

        const session = mongoClient.startSession();

        await session.withTransaction(async () => {

            await collections.users.deleteOne({ "index.userID" : userIDHash });
            await collections.payments.deleteOne({ "index.userID" : userIDHash });
            await collections.jwts.deleteMany({ userIDHash });
            await collections.ai.deleteOne({ userIDHash });
            await collections.courses.deleteOne({ userIDHash});
            await collections.authentication.deleteOne({ userIDHash });

            if (accountType == "student") {

                const schoolData = await schools.getSchoolDataBySchoolID(schoolID);
    
                await schools.removeStudent(utils.decrypt(schoolData.adminUserID, "base64"), userID);
    
            }

            if (accountType == "admin") {
    
                await schools.deleteSchool(userID);
    
            }

            (await stripeAPI.subscriptions.list({ customer : stripeCustomerID })).data.forEach(async (sub) => {
                
                await stripeAPI.subscriptions.cancel(sub.id);

            });

            await stripeAPI.customers.del(stripeCustomerID);

        })

    }

};

const authentication = {

    verifyPassword : async (username, password) => {

        const results = await users.getUserInfo(username, "username", ["passwordDigest", "passwordSalt"]);

        if (results.length == 0) {

            return false;

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032", "Multiple users with the same username exist.").throwError();

        }

        else {

            const userData = results[0];

            return crypto.timingSafeEqual(utils.passwordHash(password + process.env.PASSWORD_PEPPER, userData.passwordSalt, 64), Buffer.from(userData.passwordDigest, "base64"));

        }

    },

    sendMFAEmail : async (userID) => {

        const userData = (await users.getUserInfo(userID, "userID", ["username", "email"]))[0];

        const emailVerifcationCode = crypto.randomBytes(6).toString("hex");

        await collections.authentication.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { code : utils.encrypt(emailVerifcationCode, "hex"), timestamp : Date.now() } });

        const emailContent = `Here is your code to verify your account: <br> <h5>${emailVerifcationCode}</h5>`;

        await utils.sendEmail(authEmailTransport, "Aristotle Academy MFA Code", emailContent, userData.email, true, userData.username);

    },

    verifyMFACode : async (userID, code) => {

        const results = await collections.authentication.find({ userIDHash : utils.hash(userID, "base64")}).toArray();

        if (results.length == 0) {

            return false;

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032", "Multiple users with the same userID exist.").throwError();

        }

        else {

            const authenticationData = results[0];

            if (Date.now() > authenticationData.timestamp + 1000*60*30) {

                return false;

            }

            return crypto.timingSafeEqual(Buffer.from(code, "hex"), Buffer.from(utils.decrypt(authenticationData.code, "hex"), "hex"));

        }

    }

};

const authorization = {

    saveJWTId: async (userID, jwtID) => {

        const results = await users.getUserInfo(userID, "userID", ["userID"]);

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const userIDHash = utils.hash(userID, "base64");
            const jwtIDHash = utils.hash(jwtID, "base64");

            await collections.jwts.insertOne({ userIDHash, jwtIDHash, createdAt : new Date() });

        }

    },

    verifyJWTId: async (userID, jwtID) => {

        const userIDHash = utils.hash(userID, "base64");
        const jwtIDHash = utils.hash(jwtID, "base64");

        const result = await collections.jwts.find({ userIDHash, jwtIDHash }).toArray();

        if (result.length == 0) {

            return false;

        }

        else if (result.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            if (Date.now() - result[0].createdAt > process.env.JWT_EXPIRES_MS) {

                return false;

            }

            return true;

        }

    },

    deleteJWT : async (userID, jwtID) => {

        const userIDHash = utils.hash(userID, "base64");
        const jwtIDHash = utils.hash(jwtID, "base64");

        const result = await collections.jwts.find({ userIDHash, jwtIDHash }).toArray();

        if (result.length == 0) {

            return;

        }

        else if (result.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            await collections.jwts.deleteOne({ userIDHash, jwtIDHash });

        }

    }

};

const verification = {

    verifyUserID: async (username, userID) => {

        const results = await users.getUserInfo(username, "username",  ["userID"])

        if (results.length == 0) {

            return false;

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const databaseUserID = results[0].userID;

            return crypto.timingSafeEqual(Buffer.from(utils.hash(userID, "base64"), "base64"), Buffer.from(utils.hash(databaseUserID, "base64"), "base64"));

        }

    }

};

const payments = {

    addCoursePayment: async (userID, courseID) => {

        const result = await collections.payments.find({ "index.userID": utils.hash(userID, "base64") }).toArray();

        if (result.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (result.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            if (courseIDs.includes(courseID)) {

                await collections.payments.updateOne({ "index.userID": utils.hash(userID, "base64") }, { $set: { [`data.courses.${courseID}`]: true } })

            }

            else {
                
                new utils.ErrorHandler("0x000014").throwError();

            }

        }

    },

    getSubID : async (userID) => {

        const results = await collections.payments.find({ "index.userID" : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return utils.decrypt(results[0].data.subID, "utf-8");

        }

    },

    updateSubID: async (customerID, newSubID) => {

        const result = await collections.payments.find({ "index.stripeCustomerID" : utils.hash(customerID, "utf-8") }).toArray();

        if (result.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (result.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            await collections.payments.updateOne({ "index.stripeCustomerID" : utils.hash(customerID, "utf-8") }, { $set: { "data.subID": utils.encrypt(newSubID, "utf-8") } });

        }

    },

    checkIfPaidFor: async (userID, courseID) => {

        const paymentDataResults = await collections.payments.find({ "index.userID": utils.hash(userID, "base64") }).toArray();

        if (paymentDataResults.length == 0) {

            return false;

        }

        else if (paymentDataResults.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const paymentData = paymentDataResults[0].data;

            if (paymentData.subID.content) {

                const subscription = await stripeAPI.subscriptions.retrieve(utils.decrypt(paymentData.subID, "utf-8"));

                if (subscription.status == "active") {

                    return true;

                }

            }

            const userDataResults = await users.getUserInfo(userID, "userID", ["schoolID", "accountType"]);

            if (userDataResults.length == 0) {

                return false;
    
            }
    
            else if (userDataResults.length > 1) {
    
                new utils.ErrorHandler("0x000032").throwError();
    
            }

            else {

                if (userDataResults[0].accountType == "student") {

                    const schoolID = userDataResults[0].schoolID;

                    if (schoolID) {

                        const schoolDataResults = await (collections.schools.find({ schoolIDHash: utils.hash(schoolID, "base64") })).toArray();

                        if (schoolDataResults.length > 1) {

                            new utils.ErrorHandler("0x000032").throwError();

                        }

                        else if (schoolDataResults.length == 1) {

                            const schoolData = schoolDataResults[0];

                            const userIDHash = utils.hash(userID, "base64")

                            if (schoolData.studentUserIDs.reduce((acc, elem) => { return acc || userIDHash == elem, "base64" }, false)); {

                                if (schoolData.schoolSubID.content) {

                                    const subscription = await stripeAPI.subscriptions.retrieve(utils.decrypt(schoolData.schoolSubID, "utf-8"));

                                    if (subscription.status == "active") {

                                        return true;

                                    }

                                }

                            }

                        }

                    }

                }

            }

            const courseData = paymentData.courses;

            return courseData[courseID];

        }

    }

};

const courses = {

    // returns list, first element is the lesson number, second element is the lesson chunk
    getLessonIndexes : async (userID, courseID) => {

        const results = await collections.courses.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const userCourseData = results[0].courseData;

            if (!courseData[courseID]) {

                new utils.ErrorHandler("0x000000", "Course does not exist").throwError();

            }

            return [userCourseData[courseID].currentLessonNumber, userCourseData[courseID].currentLessonChunk];

        }

    },

    updateLessonIndexes : async (userID, courseID, newLessonNumber, newLessonChunk) => {

        const results = await collections.courses.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const userCourseData = results[0].courseData;

            if (!userCourseData[courseID]) {

                new utils.ErrorHandler("0x00003C", "Course does not exist").throwError();

            }

            const oldLessonNumber = userCourseData[courseID].currentLessonNumber;
            const oldLessonChunk = userCourseData[courseID].currentLessonChunk;
            
            await collections.courses.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { [`courseData.${courseID}.currentLessonNumber`] : Math.max(newLessonNumber, oldLessonNumber), [`courseData.${courseID}.currentLessonChunk`] : Math.max(newLessonChunk, oldLessonChunk) } });


        }

    },

    getCompletedTopics : async (userID) => {

        const results = await collections.courses.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return results[0].completedTopics;

        }

    },

    addCompletedTopic : async (userID, completedTopic) => {

        const results = await collections.courses.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const newCompletedTopics = results[0].completedTopics;

            newCompletedTopics.push(completedTopic);

            await collections.courses.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { completedTopics : newCompletedTopics }});

        }

    },

    getSessionTimes : async (userID, courseID) => {

        const results = await collections.courses.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return results[0].courseData[courseID].sessionTimes;

        }

    },

    updateSessionTimes : async (userID, courseID, sessionTime) => {

        const results = await collections.courses.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const newSessionTimes = results[0].courseData[courseID].sessionTimes

            newSessionTimes.push(sessionTime);

            await collections.courses.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { [`courseData.${courseID}.sessionTimes`] : newSessionTimes }});

        }
        
    },

    setChunkContentFormat : async (userID, courseID,  lessonNumber, lessonChunk, contentFormat) => {

        const results = await collections.courses.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const newChunkContentTypes = results[0].courseData[courseID].chunkContentTypes

            if (!newChunkContentTypes[lessonNumber]) {

                newChunkContentTypes[lessonNumber] = [];

            }
            
            newChunkContentTypes[lessonNumber][lessonChunk] = contentFormat;

            await collections.courses.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { [`courseData.${courseID}.chunkContentTypes`] : newChunkContentTypes }});

        }

    },

    getLessonChunkContentFormats : async (userID, courseID, lessonNumber) => {

        const results = await collections.courses.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return results[0].courseData[courseID].chunkContentTypes[lessonNumber] || [];

        }

    }

};

const ai = {

    redis : {

        set : async (key, val) => await redisClient.set(key, val),
        setJSON : async (key, val, path="$") => await redisClient.json.set(key, path, val),
        get : async (key) => await redisClient.get(key),
        getJSON : async (key, path="$") => await redisClient.json.get(key, { path }),
        del : async (key) => await redisClient.del(key),
        delJSON : async (key, path="$") => await redisClient.json.del(key, path)
    
    },

    setUserNumChunks : async (userID, numChunks) => {

        const results = await collections.ai.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            await collections.courses.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { numChunks }});

        }

    },

    getUserNumChunks : async (userID) => {

        const results = await collections.ai.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return results[0].numChunks;

        }

    }

};

const schools = {

    createSchool : async (adminUserID, schoolName, maxNumStudents, ipAddr) => {

        const adminUserIDHash = utils.hash(adminUserID, "base64");
        
        const adminUserIDResults = await (collections.schools.find({ adminUserIDHash })).toArray();

        if (adminUserIDResults.length == 1) {

            new utils.ErrorHandler("0x00004E").throwError();

        }

        else if (adminUserIDResults.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        let schoolID;
        let accessCode;

        let schoolIDHash;
        let accessCodeHash;

        let schoolIDExists;

        do {

            schoolID = crypto.randomBytes(256).toString("base64");

            schoolIDHash = utils.hash(schoolID, "base64");

            const schoolIDResults = await (collections.schools.find({ schoolIDHash })).toArray();

            if (schoolIDResults.length > 1) {

                new utils.ErrorHandler("0x000032").throwError();
    
            }

            schoolIDExists = schoolIDResults.length == 1;

        } while (schoolIDExists)

        let accessCodeExists;

        do {

            accessCode = crypto.randomBytes(4).toString("hex")

            accessCodeHash = utils.hash(accessCode, "hex");

            const accessCodeResults = await (collections.schools.find({ accessCodeHash })).toArray();

            if (accessCodeResults.length > 1) {

                new utils.ErrorHandler("0x000032").throwError();
    
            }

            accessCodeExists = accessCodeResults.length == 1;

        } while (accessCodeExists)

        const data = {

            adminUserIDHash,
            schoolIDHash,
            accessCodeHash,
            maxNumStudents : utils.encrypt(maxNumStudents.toString(), "utf-8"),
            studentUserIDs : [],
            schoolName : utils.encrypt(schoolName, "utf-8"),
            ipAddr : utils.encrypt(ipAddr, "utf-8"),
            schoolSubID : utils.encrypt("", "utf-8"),
            adminUserID : utils.encrypt(adminUserID, "base64"),
            schoolID : utils.encrypt(schoolID, "base64"),
            accessCode : utils.encrypt(accessCode, "hex")

        }

        await collections.schools.insertOne(data)

    },

    getSchoolData : async (adminUserID) => {

        const results = await (collections.schools.find({ adminUserIDHash : utils.hash(adminUserID, "base64") })).toArray();

        if (results.length == 0) {

            return null;

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return results[0];

        }

    },

    getSchoolDataBySchoolID : async (schoolID) => {

        const results = await (collections.schools.find({ schoolIDHash : utils.hash(schoolID, "base64") })).toArray();

        if (results.length == 0) {

            return null;

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return results[0];

        }

    },

    getSchoolDataByAccessCode : async (accessCode) => {

        const results = await (collections.schools.find({ accessCodeHash : utils.hash(accessCode, "hex") })).toArray();

        if (results.length == 0) {

            return null;

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return results[0];

        }

    },

    updateSchoolSubID : async (adminUserID, newSubID, newMaxNumStudents) => {

        const adminUserIDHash = utils.hash(adminUserID, "base64");

        const results = await (collections.schools.find({ adminUserIDHash })).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            await collections.schools.updateOne({ adminUserIDHash }, { $set: { schoolSubID: utils.encrypt(newSubID, "utf-8"), maxNumStudents : utils.encrypt(newMaxNumStudents.toString(), "utf-8") } });

        }

    },

    addStudent : async (adminUserID, studentUserID) => {

        const adminUserIDHash = utils.hash(adminUserID, "base64");

        const results = await (collections.schools.find({ adminUserIDHash })).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const students = await users.getUserInfo(studentUserID, "userID", ["userID"]);

            if (students.length == 0) {

                new utils.ErrorHandler("0x000031").throwError();
    
            }
    
            else if (students.length > 1) {
    
                new utils.ErrorHandler("0x000032").throwError();
    
            }

            else {

                const school = results[0];

                const studentUserIDHash = utils.hash(studentUserID, "base64");

                school.studentUserIDs.push(studentUserIDHash);

                const session = mongoClient.startSession();

                await session.withTransaction(async () => {        

                    await collections.schools.updateOne({ adminUserIDHash }, { $set : { studentUserIDs : school.studentUserIDs }});
                    await collections.users.updateOne({ "index.userID" : studentUserIDHash }, { $set : { "data.accountType" : utils.encrypt("student", "utf-8") }});
                    await collections.users.updateOne({ "index.userID" : studentUserIDHash }, { $set : { "data.schoolID" : utils.encrypt(utils.decrypt(school.schoolID, "base64"), "base64") }}); // encryption is rerun so as to prevent data repetition
                    await collections.payments.updateOne({ "index.userID" : studentUserIDHash }, { $set : { "data.schoolID" : utils.encrypt(utils.decrypt(school.schoolID, "base64"), "base64") }}); // encryption is rerun so as to prevent data repetition

                });

            }

        }

    },

    removeStudent : async (adminUserID, studentUserID) => {

        const adminUserIDHash = utils.hash(adminUserID, "base64");

        const results = await (collections.schools.find({ adminUserIDHash })).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const students = await users.getUserInfo(studentUserID, "userID", ["userID"]);

            if (students.length == 0) {

                new utils.ErrorHandler("0x000031").throwError();
    
            }
    
            else if (students.length > 1) {
    
                new utils.ErrorHandler("0x000032").throwError();
    
            }

            else {

                const school = results[0];

                const studentUserIDHash = utils.hash(studentUserID, "base64")

                if (school.studentUserIDs.indexOf(studentUserIDHash) != -1) {

                    school.studentUserIDs.splice(school.studentUserIDs.indexOf(studentUserIDHash), 1);

                }


                const session = mongoClient.startSession();

                await session.withTransaction(async () => {        

                    await collections.schools.updateOne({ adminUserIDHash }, { $set : { studentUserIDs : school.studentUserIDs }});
                    await collections.users.updateOne({ "index.userID" : studentUserIDHash }, { $set : { "data.accountType" : utils.encrypt("individual", "utf-8") }});
                    await collections.users.updateOne({ "index.userID" : studentUserIDHash }, { $set : { "data.schoolID" : utils.encrypt("", "base64") }});
                    await collections.payments.updateOne({ "index.userID" : studentUserIDHash }, { $set : { "data.schoolID" : utils.encrypt("", "base64") }});

                });

            }

        }

    },

    deleteSchool : async (adminUserID) => {

        const adminUserIDHash = utils.hash(adminUserID, "base64");

        const results = await (collections.schools.find({ adminUserIDHash })).toArray();
        
        if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else if (results.length == 1) {

            const school = results[0];

            const session = mongoClient.startSession();

             await session.withTransaction(async () => {        

                await collections.schools.deleteOne({ adminUserIDHash });
                await collections.users.updateMany({ "index.userID" : { $in : school.studentUserIDs } }, { $set : { "data.accountType" : utils.encrypt("individual", "utf-8") }});
                await collections.users.updateMany({ "index.userID" : { $in : school.studentUserIDs } }, { $set : { "data.schoolID" : utils.encrypt("", "base64") }});

                if (school.schoolSubID.content) {

                    await stripeAPI.subscriptions.cancel(utils.decrypt(school.schoolSubID.content, "utf-8"));

                }

            });

        }

    },

};

const config = {

    getConfigData : async (name) => {

        const results = await collections.config.find({ name : (`${developmentMode ? "dev_" : ""}${name}`) }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return results[0].data;

        }

    },

    setConfigData : async (name, newData) => {

        await collections.config.updateOne({ name }, { data : newData }, { upsert : true });

    },

    updateConfigData : async (name, property, value) => {

        const results = await collections.config.find({ name }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            await collections.config.updateOne({ name }, { [`data.${property}`] : value });

        }

    }

};

export default {
    
    users,
    authentication,
    authorization,
    verification,
    payments,
    courses,
    ai,
    schools,
    config

};