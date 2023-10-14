import crypto from "crypto"
import dotenv from "dotenv"
import fs from "fs"
import { MongoClient, ServerApiVersion } from "mongodb"
import stripe from "stripe"
import utils from "./utils.js"

dotenv.config();

const stripeAPI = stripe(process.env.STRIPE_SK);

const mongodbURI = `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@${process.env.MONGODB_HOSTNAME}/?retryWrites=true&w=majority`;

const client = new MongoClient(mongodbURI, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

await client.connect();

const db = client.db(process.env.MONGODB_DB_NAME);

const collections = {

    users : db.collection("users"),
    payments : db.collection("payments"),
    jwts : db.collection("jwts"), 
    checkoutSessions : db.collection("checkout-sessions")
    
}

await collections.jwts.createIndex({ createdAt: 1 }, { expireAfterSeconds: (+process.env.JWT_EXPIRES_MS)/1000 });
await collections.checkoutSessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: (+process.env.CHECKOUT_SESSION_TIMEOUT_MS)/1000 });

const courseData = JSON.parse(fs.readFileSync("course_data.json"));
const courseNames = Object.keys(courseData);

const propertyEncodings = {

    userID : "base64",
    stripeCustomerID : "utf-8",
    username : "utf-8",
    email : "utf-8",
    passwordDigest : "base64",
}

const userDataProperties = ["userID", "stripeCustomerID", "username", "email", "passwordDigest", "passwordSalt"]
const userIndexProperties = ["username", "email", "userID", "stripeCustomerID"]; // placing a property here will mandate it's uniqueness amongst relevant documents
const paymentDataProperties = ["subID", "courses"]
const paymentIndexProperties = ["userID", "stripeCustomerID"]; // placing a property here will mandate it's uniqueness amongst relevant documents

const allProperties = Array.from(new Set([...userDataProperties, ...userIndexProperties, ...paymentDataProperties, ...paymentIndexProperties]));

const bannedPasswordRegexPatterns = fs.readFileSync("password_regex_blacklist.txt").toString("utf-8").split("\n");
const passwordCheckStatuses = JSON.parse(fs.readFileSync("password_check_statuses.json"));

// returns integer, if password is valid, 0 is returned, otherwise, some other positive integer is returned. see password_check_statuses.json for more detail
const checkNewPassword = async (password) => {

    if (!(typeof password === 'string' || password instanceof String)) {

        return 1;

    }

    if (password.length < 8) {

        return 2;

    }



    for (let i = 0; i < bannedPasswordRegexPatterns.length; i++) {

        const regex = new RegExp(bannedPasswordRegexPatterns[i], "i");

        if (regex.test(password) == true) {

            return 3;

        }

    }

    const passwordDigest = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();

    const hashPrefix = passwordDigest.substring(0, 5);
    const hashSuffix = passwordDigest.substring(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${hashPrefix}`);

    if (!res.ok) {

        new utils.ErrorHandler("0x00000E").throwError();

    }

    const data = await res.text();

    const passwordSuffixes = data.split("\n").map(elem => elem.split(":")[0]);

    return passwordSuffixes.includes(hashSuffix) ? 4 : 0;

};

const users = {

    addNewUser: async (username, email, password) => {

        let userID = crypto.randomBytes(256).toString("base64");

        let userIDResults = await users.getUserInfo(userID, "userID", ["userID"]);
        const usernameResults = await users.getUserInfo(username, "username", ["userID"]);
        const emailResults = await users.getUserInfo(email, "email", ["userID"]);
        
        while (userIDResults.length > 0) {

            userID = crypto.randomBytes(256).toString("base64");

            userIDResults = await users.getUserInfo(userID, "userID", ["userID"]);

        }

        if (usernameResults.length > 0) {

            new utils.ErrorHandler("0x000005", "Username is already in use.").throwError();

        }

        if (emailResults.length > 0) {

            new utils.ErrorHandler("0x000005", "Email is already in use.").throwError();

        }

        const passwordStatus = await checkNewPassword(password);

        if (passwordStatus != 0) {

            new utils.ErrorHandler("0x000006", passwordCheckStatuses[passwordStatus] || "Password is invalid.").throwError();

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

                    new utils.ErrorHandler("0x000006", "Email is invalid.").throwError();

                default:

                    new utils.ErrorHandler("0x000000", error.raw.message).throwError();

            }

        }

        const passwordSalt = crypto.randomBytes(+process.env.SALT_SIZE).toString("base64");

        const allData = {

            userID,
            stripeCustomerID: customer.id,
            username,
            email,
            passwordDigest: utils.passwordHash(password + process.env.PASSWORD_PEPPER, passwordSalt, 64).toString("base64"),
            passwordSalt,
            subID: undefined,
            courses: {}

        };

        if (Object.keys(allData).reduce((hasInvalidProperty, propertyName) => { return hasInvalidProperty || !allProperties.includes(propertyName) }, false)) {

            new utils.ErrorHandler("0x000008", "Unexpected property exists in allData.").throwError();

        }

        if (allProperties.reduce((hasInvalidProperty, propertyName) => { return hasInvalidProperty || !Object.keys(allData).includes(propertyName) }, false)) {

            new utils.ErrorHandler("0x000008", "Missing property in allData.").throwError();

        }

        const userData = Object.keys(allData).filter(key => userDataProperties.includes(key)).reduce((obj, key) => {

            obj[key] = utils.encrypt(allData[key], propertyEncodings[key] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError());

            return obj;

        }, {});

        const userIndex = Object.keys(allData).filter(key => userIndexProperties.includes(key)).reduce((obj, key) => {

            obj[key] = utils.hash(allData[key], propertyEncodings[key] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError());

            return obj;

        }, {});

        const paymentData = Object.keys(allData).filter(key => paymentDataProperties.includes(key)).reduce((obj, key) => {

            obj[key] = utils.encrypt(allData[key], propertyEncodings[key] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError());

            return obj;

        }, {});

        const paymentIndex = Object.keys(allData).filter(key => paymentIndexProperties.includes(key)).reduce((obj, key) => {

            obj[key] = utils.hash(allData[key], propertyEncodings[key] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError());

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

        await collections.users.insertOne(userDocument);
        await collections.payments.insertOne(paymentDocument);

        return allData.userID;


    },

    getUserInfo: async (query, queryPropertyName, resultPropertyNames) => {

        if (!userIndexProperties.includes(queryPropertyName)) {

            new utils.ErrorHandler("0x000003", `${queryPropertyName} does not exist in the user index.`).throwError();

        }

        const nonexistantResultPropertyNames = resultPropertyNames.filter((resultPropertyName) => !userDataProperties.includes(resultPropertyName))

        if (nonexistantResultPropertyNames.length > 0) {

            new utils.ErrorHandler("0x000003", `${nonexistantResultPropertyNames[0]} does not exist in the user data.`).throwError();

        }

        if (!propertyEncodings[queryPropertyName]) {

            new utils.ErrorHandler("0x000008", `Encoding information missing for ${queryPropertyName}`).throwError();

        }

        const missingEncodingPropertyNames = resultPropertyNames.filter((resultPropertyName) => !(Object.keys(propertyEncodings)).includes(resultPropertyName));

        if (missingEncodingPropertyNames.length > 0) {

            new utils.ErrorHandler("0x000008", `Encoding information missing for ${missingEncodingPropertyNames[0]}`).throwError();

        }

        const projection = resultPropertyNames.reduce((obj, resultPropertyName) => {

            obj[`data.${resultPropertyName}`] = 1;
            
            return obj;

        }, {}); 

        const results = await collections.users.find({ [`index.${queryPropertyName}`]: utils.hash(query, propertyEncodings[queryPropertyName]) }, { projection } ).toArray();

        const usersData = results.map((userData) => {

                const decryptedUserData = Object.keys(userData.data).reduce((obj, key) => { 
                
                        obj[key] = utils.decrypt(userData.data[key], propertyEncodings[key] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`)).throwError();
                
                        return obj;
                    
                    }, {});
    
                return decryptedUserData;

            });

        return usersData;

    },

    changeUserInfo: async (query, queryPropertyName, toChangeValue, toChangePropertyName) => {

        const results = await users.getUserInfo(query, queryPropertyName, ["userID"]);

        if (results.length == 0) {

            new utils.ErrorHandler("0x00000A").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x00000C", `Multiple users with the same ${queryPropertyName} exist .`).throwError();

        }

        else {

            if (!userDataProperties.includes(toChangePropertyName) || toChangePropertyName == "userID") {

                new utils.ErrorHandler("0x000004", "Property either does not exist or is not allowed to be changed.").throwError();

            }

            const userData = results[0];

            const userIDHash = utils.hash(userData.userID, propertyEncodings["userID"]);

            if (userIndexProperties.includes(toChangePropertyName)) {

                if ((await (collections.users.find({ [`index.${toChangePropertyName}`] : utils.hash(toChangeValue, propertyEncodings[toChangePropertyName] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError()) })).toArray()).length > 0) {

                    new utils.ErrorHandler("0x000005 ", `The same ${toChangePropertyName} already has an account associated with it.`).throwError();

                }

                await collections.users.updateOne({ [`index.${queryPropertyName}`]: utils.hash(query, propertyEncodings[queryPropertyName] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError()) }, { $set: { [`index.${toChangePropertyName}`]: utils.hash(toChangeValue, new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError()) } })

            }

            if (paymentIndexProperties.includes(toChangePropertyName)) {

                if ((await (collections.payments.find({ [`index.${toChangePropertyName}`] : utils.hash(toChangeValue, propertyEncodings[toChangePropertyName] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError()) })).toArray()).length > 0) {

                    new utils.ErrorHandler("0x000005 ", `The same ${toChangePropertyName} already has an account associated with it.`).throwError();

                }

                await collections.users.updateOne({ [`index.${queryPropertyName}`]: utils.hash(query, propertyEncodings[queryPropertyName] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError()) }, { $set: { [`index.${toChangePropertyName}`]: utils.hash(toChangeValue, new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError()) } })

            }

            if (toChangePropertyName == "password") {

                const passwordSalt = crypto.randomBytes(+process.env.SALT_SIZE).toString("base64");

                const passwordDigest = utils.passwordHash(toChangeValue + process.env.PASSWORD_PEPPER, passwordSalt, 64).toString("base64");

                await collections.users.updateOne({ "index.userID" : userIDHash }, { $set: { 

                    "data.passwordDigest" : utils.encrypt(passwordDigest, propertyEncodings["passwordDigest"]), 
                    "data.passwordSalt" : utils.encrypt(passwordSalt, propertyEncodings["passwordSalt"])

                }});
                
                return;

            }

            await collections.users.updateOne({ "index.userID" : userIDHash }, { $set: { [`data.${toChangePropertyName}`]: utils.encrypt(toChangeValue, propertyEncodings[toChangePropertyName] || new utils.ErrorHandler("0x000008", `Encoding information missing for ${key}`).throwError()) } });

        }

    },

    deleteUser : async (username, userID) => {

        if (!(await verification.verifyUserID(username, userID))) {

            new utils.ErrorHandler("0x000009").throwError();

        };

        const userIDHash = utils.hash(userID, "base64");
        const stripeCustomerID = (await users.getUserInfo(userID, "userID", ["stripeCustomerID"]))[0].stripeCustomerID;

        await stripeAPI.customers.del(stripeCustomerID);

        await collections.users.deleteOne({ "index.userID" : userIDHash });
        await collections.payments.deleteOne({ "index.userID" : userIDHash });
        await collections.jwts.deleteMany({ userIDHash });

    }

};

const authentication = {

    verifyPassword: async (username, password) => {

        const results = await users.getUserInfo(username, "username", ["passwordDigest", "passwordSalt"])

        if (results.length == 0) {

            return false;

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000001", "Multiple users with the same username exist.").throwError();

        }

        else {

            const userData = results[0];

            return crypto.timingSafeEqual(utils.passwordHash(password + process.env.PASSWORD_PEPPER, userData.passwordSalt, 64), Buffer.from(userData.passwordDigest, "base64"));

        }

    }

};

const authorization = {

    saveJWTId: async (userID, jwtID) => {

        const results = await users.getUserInfo(userID, "userID", ["userID"]);

        if (results.length == 0) {

            new utils.ErrorHandler("0x00000A").throwError();

        }

        else if (results.length > 1) {

            new utils.ErrorHandler("0x000001").throwError();

        }

        else {

            const userIDHash = utils.hash(userID, "base64");
            const jwtIDHash = utils.hash(jwtID, "base64");

            await collections.jwts.insertOne({ userIDHash, jwtIDHash });

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

            new utils.ErrorHandler("0x000001").throwError();

        }

        else {

            return true;

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

            new utils.ErrorHandler("0x000001").throwError();

        }

        else {

            const databaseUserID = results[0].userID;

            return crypto.timingSafeEqual(Buffer.from(utils.hash(userID, "base64"), "base64"), Buffer.from(utils.hash(databaseUserID, "base64"), "base64"));

        }

    }

};

const payments = {

    createCheckoutSession: async (sessionID, userID, item) => {

        const result = await users.getUserInfo(userID, "userID", ["userID"]);

        if (result.length == 0) {

            new utils.ErrorHandler("0x00000A").throwError();

        }

        else if (result.length > 1) {

            new utils.ErrorHandler("0x000001").throwError();

        }

        else {

            collections.checkoutSessions.insertOne({ sessionIDHash: utils.hash(sessionID, "base64"), userID: utils.encrypt(userID, "base64"), item: utils.encrypt(item, "utf-8") });

        }

    },

    getCheckoutSession: async (sessionID) => {

        const result = await collections.checkoutSessions.find({ sessionIDHash: utils.hash(sessionID, "base64") }).toArray()

        if (result.length == 0) {

            new utils.ErrorHandler("0x00000D").throwError();

        }

        else if (result.length > 1) {

            new utils.ErrorHandler("0x000001").throwError();

        }

        else {

            const userID = utils.decrypt(result[0].userID, "base64");
            const item = utils.decrypt(result[0].item, "utf-8");

            return { userID, item };

        }

    },

    deleteCheckoutSession: async (sessionID) => {

        const result = await collections.checkoutSessions.find({ sessionIDHash: utils.hash(sessionID, "base64") }).toArray();

        if (result.length == 0) {

            new utils.ErrorHandler("0x00000D").throwError();

        }

        else if (result.length > 1) {

            new utils.ErrorHandler("0x000001").throwError();

        }

        else {

            await collections.checkoutSessions.deleteOne(result[0])

        }

    },

    addCoursePayment: async (userID, courseName) => {

        const result = await collections.payments.find({ userIDHash: utils.hash(userID, "base64") }).toArray();

        if (result.length == 0) {

            // TODO : refund payment if userID is not found in payments database

        }

        else if (result.length > 1) {

            new utils.ErrorHandler("0x000001").throwError();

        }

        else {

            if (courseNames.includes(courseName)) {

                let courseData = result[0].courses ? result[0].courses : {};

                courseData[courseName] = true;

                await collections.payments.updateOne({ userIDHash: utils.hash(userID, "base64") }, { $set: { courses: courseData } })

            }

        }

    },

    updateSubID: async (customerID, newSubID) => {

        console.log(customerID);
        console.log(utils.hash(customerID, "utf-8"))

        const result = await collections.payments.find({ "index.stripeCustomerID" : utils.hash(customerID, "utf-8") }).toArray();

        if (result.length == 0) {

            new utils.ErrorHandler("0x00000D").throwError();

            // TODO : refund payment if userID is not found in payments database

        }

        else if (result.length > 1) {

            new utils.ErrorHandler("0x000001").throwError();

        }

        else {

            await collections.payments.updateOne({ "index.stripeCustomerID" : utils.hash(customerID, "utf-8") }, { $set: { "data.subID": utils.encrypt(newSubID, "utf-8") } });

        }

    },

    checkIfPaidFor: async (userID, courseName) => {

        const result = await collections.payments.find({ "index.userID": utils.hash(userID, "base64") }).toArray();

        if (result.length == 0) {

            return false;

        }

        else if (result.length > 1) {

            new utils.ErrorHandler("0x000001").throwError();

        }

        else {

            const paymentData = result[0].data;

            if (paymentData.subID) {

                const subscription = await stripeAPI.subscriptions.retrieve(utils.decrypt(paymentData.subID, "utf-8"));

                if (subscription.status == "active") {

                    return true;

                }

            }

            const courseData = paymentData.courses;

            return courseData && courseData[courseName];

        }

    }

};

export default {
    
    users,
    authentication,
    authorization,
    verification,
    payments

};