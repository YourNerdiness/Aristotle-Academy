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
    topics : db.collection("courses"),
    ai : db.collection("ai"),
    schools : db.collection("schools"),
    chat : db.collection("chat"),
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

let courseData, topicData, courseIDs, topicIDs, defaultTopicData, defaultCoursePaymentData, propertyEncodings, userDataProperties, userIndexProperties, paymentDataProperties, paymentIndexProperties, allProperties, passwordCheckStatuses;

const updateConfig = async () => {

    const courseDataResults = await collections.config.find({ name: `${developmentMode ? "dev_" : ""}course_data` }).toArray();

    if (courseDataResults.length == 0) {

        new utils.ErrorHandler("0x000018").throwError();

    }

    else if (courseDataResults.length > 1) {

        new utils.ErrorHandler("0x000019").throwError();

    }

    else {

        courseData = courseDataResults[0].data;

    }

    const topicDataResults = await collections.config.find({ name: `${developmentMode ? "dev_" : ""}topic_data` }).toArray();

    if (topicDataResults.length == 0) {

        new utils.ErrorHandler("0x000018").throwError();

    }

    else if (topicDataResults.length > 1) {

        new utils.ErrorHandler("0x000019").throwError();

    }

    else {

        topicData = topicDataResults[0].data;

    }

    courseIDs = Object.keys(courseData);
    topicIDs = Object.keys(topicData);

    defaultTopicData = topicIDs.reduce((obj, key) => {

        obj[key] = { currentLessonChunk: 0, sessionTimes: [], chunkContentTypes: [] };

        return obj;

    }, {});

    defaultCoursePaymentData = courseIDs.reduce((obj, key) => {

        obj[key] = false;

        return obj;

    }, {});

    propertyEncodings = {

        userID: "base64",
        stripeCustomerID: "utf-8",
        username: "utf-8",
        email: "utf-8",
        passwordDigest: "base64",
        passwordSalt: "base64",
        subID: "utf-8",
        accountType: "utf-8",
        schoolID: "base64",
        courses: "object"
    }

    userDataProperties = ["userID", "stripeCustomerID", "username", "email", "passwordDigest", "passwordSalt", "accountType", "schoolID"]
    userIndexProperties = ["username", "email", "userID", "stripeCustomerID"]; // placing a property here will mandate it's uniqueness amongst relevant documents
    paymentDataProperties = ["subID", "courses", "schoolID"]
    paymentIndexProperties = ["userID", "stripeCustomerID"]; // placing a property here will mandate it's uniqueness amongst relevant documents

    allProperties = Array.from(new Set([...userDataProperties, ...userIndexProperties, ...paymentDataProperties, ...paymentIndexProperties]));

    passwordCheckStatuses = JSON.parse(fs.readFileSync("password_check_statuses.json"));

};

await updateConfig();

const updateConfigClockCallback = async () => {

    await updateConfig();

    setTimeout(updateConfigClockCallback, process.env.CONFIG_CLOCK_MS);

};

setTimeout(updateConfigClockCallback, process.env.CONFIG_CLOCK_MS);

const users = {

    addNewUser: async (username, email, password, accountType="individual") => {

        if (!["individual", "student", "admin"].includes(accountType)) {

            new utils.ErrorHandler("0x00003C").throwError();

            return;

        }

        let userID = crypto.randomBytes(256).toString("base64");

        const userIDResultsProm = users.getUserInfo(userID, "userID", ["userID"]);
        const usernameResultsProm = users.getUserInfo(username, "username", ["userID"]);
        const emailResultsProm = users.getUserInfo(email, "email", ["userID"]);
        
        let userIDResults = await userIDResultsProm;
        const usernameResults = await usernameResultsProm;
        const emailResults = await emailResultsProm;

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

        const emailVerificationCode = crypto.randomBytes(4).toString("hex");

        const welcomeEmailContent = `Welcome to Aristotle Academy, we hope you'll benefit from our service. Here is your code to verify your email: <br> <h5>${emailVerificationCode}</h5>`;

        await utils.sendEmail(authEmailTransport, "Welcome to Aristotle Academy!", welcomeEmailContent, email, true, username);

        const session = mongoClient.startSession();

        await session.withTransaction(async () => {

            await collections.users.insertOne(userDocument);
            await collections.payments.insertOne(paymentDocument);

            await collections.topics.insertOne({

                userIDHash,
                topicData: defaultTopicData,
                completedTopics: []

            });

            await collections.ai.insertOne({ userIDHash, numChunks: 6, qTable : {} });

            await collections.authentication.insertOne({

                userIDHash,
                code: utils.encrypt(emailVerificationCode, "hex"),
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

        const results = await users.getUserInfo(query, queryPropertyName, ["userID", "stripeCustomerID"]);

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

            if (toChangePropertyName == "email") {

                try {

                    await stripeAPI.customers.update(userData.stripeCustomerID, { email : toChangeValue })
        
                } catch (error) {
        
                    switch (error.raw.code) {
        
                        case "email_invalid":
        
                            new utils.ErrorHandler("0x000063", "Email is invalid.").throwError();
        
                        default:
        
                            new utils.ErrorHandler("0x00001E", error.raw.message).throwError();
        
                    }
        
                }


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
            await collections.topics.deleteOne({ userIDHash});
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

        const emailVerificationCode = crypto.randomBytes(4).toString("hex");

        await collections.authentication.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { code : utils.encrypt(emailVerificationCode, "hex"), timestamp : Date.now() } });

        const emailContent = `Here is your code to verify your account: <br> <h5>${emailVerificationCode}</h5>`;

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

            return courseData[courseID] || false;

        }

    }

};

const topics = {

    getLessonChunk : async (userID, topicID) => {
        
        const results = await collections.topics.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            if (!topicIDs.includes(topicID)) {

                new utils.ErrorHandler("0x000060").throwError();

            }

            const userTopicData = results[0].topicData;

            return userTopicData[topicID]?.currentLessonChunk || 0;

        }

    },

    updateLessonChunk : async (userID, topicID, newLessonChunk) => {

        const results = await collections.topics.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            if (!topicIDs.includes(topicID)) {

                new utils.ErrorHandler("0x000060").throwError();

            }
            
            await collections.topics.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { [`topicData.${topicID}.currentLessonChunk`] : newLessonChunk } });


        }

    },

    getCompletedTopics : async (userID) => {

        const results = await collections.topics.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

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

        const results = await collections.topics.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const newCompletedTopics = results[0].completedTopics;

            newCompletedTopics.push(completedTopic);

            await collections.topics.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { completedTopics : newCompletedTopics }});

        }

    },

    getSessionTimes : async (userID, topicID) => {

        const results = await collections.topics.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            if (!topicIDs.includes(topicID)) {

                new utils.ErrorHandler("0x000014").throwError();

            }

            return results[0].topicData[topicID]?.sessionTimes || [];

        }

    },

    updateSessionTimes : async (userID, topicID, sessionTime) => {

        const results = await collections.topics.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            if (!topicIDs.includes(topicID)) {

                new utils.ErrorHandler("0x000014").throwError();

            }

            const newSessionTimes = results[0].topicData[topicID]?.sessionTimes || [];

            newSessionTimes.push(sessionTime);

            await collections.topics.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { [`topicData.${topicID}.sessionTimes`] : newSessionTimes }});

        }
        
    },

    getLessonChunkContentFormats : async (userID, topicID) => {

        const results = await collections.topics.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            if (!topicIDs.includes(topicID)) {

                new utils.ErrorHandler("0x000014").throwError();

            }

            return results[0].topicData[topicID]?.chunkContentTypes || [];

        }

    },

    setChunkContentFormat : async (userID, topicID, lessonChunk, contentFormat) => {

        const results = await collections.topics.find({ userIDHash : utils.hash(userID, "base64") }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            if (!topicIDs.includes(topicID)) {

                new utils.ErrorHandler("0x000014").throwError();

            }

            const newChunkContentTypes = results[0].topicData[topicID]?.chunkContentTypes || [];
            
            newChunkContentTypes[lessonChunk] = contentFormat;

            await collections.topics.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { [`topicData.${topicID}.chunkContentTypes`] : newChunkContentTypes }});

        }

    }

};

const ai = {

    setStateObj : async (userIDHash, state, stateObj) => {

        const results = await collections.ai.find({ userIDHash }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            await collections.ai.updateOne({ userIDHash }, { $set : { [`qTable.${state}`] : stateObj }});

        }

    },

    getStateObj : async (userIDHash, state) => {

        const results = await collections.ai.find({ userIDHash }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return results[0].qTable[state];

        }

    },

    setQValue : async (userIDHash, state, action, qValue) => {

        const results = await collections.ai.find({ userIDHash }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            await collections.ai.updateOne({ userIDHash }, { $set : { [`qTable.${state}.${action}`] : qValue }});

        }

    },

    getQValue : async (userIDHash, state, action) => {

        const results = await collections.ai.find({ userIDHash }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            return (results[0].qTable[state] || {})[action];

        }

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

            await collections.ai.updateOne({ userIDHash : utils.hash(userID, "base64") }, { $set : { numChunks }});

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

    createSchool : async (adminUserID, schoolName, maxNumStudents, domain) => {

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
            domain : utils.encrypt(domain, "utf-8"),
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

            const studentsUserData = await users.getUserInfo(studentUserID, "userID", ["stripeCustomerID"]);

            if (studentsUserData.length == 0) {

                new utils.ErrorHandler("0x000031").throwError();
    
            }
    
            else if (studentsUserData.length > 1) {
    
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

                    (await stripeAPI.subscriptions.list({ customer : studentsUserData[0].stripeCustomerID })).data.forEach(async (sub) => {
                
                        await stripeAPI.subscriptions.cancel(sub.id);
        
                    });

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

                    await stripeAPI.subscriptions.cancel(utils.decrypt(school.schoolSubID, "utf-8"));

                }

            });

        }

    },

};

const chat = {

    createNewChat : async (userID) => {

        const userIDResults = await users.getUserInfo(userID, "userID", ["userID"]);

        if (userIDResults.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (userIDResults.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        let chatID;
        let chatIDHash;
        let chatIDExists;

        do {

            chatID = crypto.randomBytes(32).toString("base64");

            chatIDHash = utils.hash(chatID, "base64");

            const chatIDResults = await (collections.schools.find({ chatIDHash })).toArray();

            if (chatIDResults.length > 1) {

                new utils.ErrorHandler("0x000032").throwError();
    
            }

            chatIDExists = chatIDResults.length == 1;

        } while (chatIDExists)

        await collections.chat.insertOne({ userIDHash, chatIDHash, messages : [] });

        return chatID;

    },

    getChat : async (chatID) => {

        const results = await collections.chat.find({ chatIDHash : utils.hash(chatID, "base64") }).toArray();

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

    addChatMessage : async (chatID, role, messageContent) => {

        const chatIDHash = utils.hash(chatID, "base64");

        const results = await collections.chat.find({ chatIDHash }).toArray();

        if (results.length == 0) {

            new utils.ErrorHandler("0x000031").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000032").throwError();

        }

        else {

            const chatData = results[0];

            const newMessages = chatData.messages;

            newMessages.push({ role, content : messageContent });

            await collections.chat.updateOne({ chatIDHash }, { $set : { messages : newMessages } });

        }

    }

}

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
    topics,
    ai,
    schools,
    chat,
    config

};