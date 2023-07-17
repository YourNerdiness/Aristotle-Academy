const crypto = require("crypto");
const { MongoClient, ServerApiVersion } = require('mongodb');
const stripe = require("stripe");
const fs = require("fs");

require("dotenv").config();

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
    passwordHash : "base64",
    passwordSalt : "base64",
    subID : "utf-8",
    courses : "object" // passing object encoding to hash or encrypt functions just returns the original object without hashing or encrypting

};

const userDataProperties = ["userID", "stripeCustomerID", "username", "email", "passwordDigest", "passwordSalt"]
const userIndexProperties = ["username", "email", "userID", "stripeCustomerID"];
const paymentDataProperties = ["subID", "courses"]
const paymentIndexProperties = ["userID", "stripeCustomerID"];

const hash = (content="", encoding) => {

    if (encoding === "object") {

        return content;

    }

    return crypto.createHash(process.env.HASHING_ALGORITHM).update(content, encoding).digest("base64");

};

const passwordHash = (password, salt, size) => {

    return crypto.scryptSync(password, salt, size);

};

const encrypt = (content="", encoding) => {

    if (encoding === "object") {

        return content;

    }

    const encryptionSalt = crypto.randomBytes(Number(process.env.SALT_SIZE)).toString("base64");

    const key = passwordHash(process.env.AES_KEY, encryptionSalt, 32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(process.env.ENCRYPTION_ALGORITHM, key, iv);

    const output = cipher.update(content, encoding, "base64") + cipher.final("base64");

    return { content : output, encryptionSalt, iv : iv.toString("base64"), authTag : cipher.getAuthTag().toString("base64") };

};

const decrypt = (encryptionData, encoding) => {

    const key = passwordHash(process.env.AES_KEY, encryptionData.encryptionSalt, 32);

    const decipher = crypto.createDecipheriv(process.env.ENCRYPTION_ALGORITHM, Buffer.from(key, "base64"), Buffer.from(encryptionData.iv, "base64"));
    
    decipher.setAuthTag(Buffer.from(encryptionData.authTag, "base64"));

    const output = decipher.update(encryptionData.content, "base64", encoding) + decipher.final(encoding);

    return output;

};

const throwError = async (msg) => {

    throw new Error(msg);

};

const users = {

    addNewUser: async (username, email, password) => {

        const results = await collections.users.find({ usernameHash: hash(username, "utf-8") }).toArray();

        if (results.length == 1) {

            throw new Error("Username is taken.");

        }

        else if (results.length > 1) {

            throw new Error("Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            let customer

            try {

                customer = await stripeAPI.customers.create({

                    name: username,
                    email

                });

            } catch (error) {

                switch (error.raw.code) {

                    case "email_invalid":

                        throw new Error("Please enter a valid email.");

                    default:

                        throw error.raw.code;

                }

            }

            const passwordSalt = crypto.randomBytes(+process.env.SALT_SIZE).toString("base64");

            const allData = {

                userID : crypto.randomBytes(256).toString("base64"),
                stripeCustomerID : customer.id,
                username,
                email,
                passwordDigest : passwordHash(password + process.env.PASSWORD_PEPPER, passwordSalt, 64).toString("base64"),
                passwordSalt,
                subID : undefined,
                courses : {}

            };

            const userData = Object.keys(allData).filter(key => userDataProperties.includes(key)).reduce((obj, key) => {

                obj[key] = encrypt(allData[key], propertyEncodings[key] || throwError(`Encoding information missing for ${key}`))

                return obj;

            }, {});

            const userIndex = Object.keys(allData).filter(key => userIndexProperties.includes(key)).reduce((obj, key) => {

                obj[key] = hash(allData[key], propertyEncodings[key] || throwError(`Encoding information missing for ${key}`))

                return obj;

            }, {});

            const paymentData = Object.keys(allData).filter(key => paymentDataProperties.includes(key)).reduce((obj, key) => {

                obj[key] = encrypt(allData[key], propertyEncodings[key] || throwError(`Encoding information missing for ${key}`))

                return obj;

            }, {});

            const paymentIndex = Object.keys(allData).filter(key => paymentIndexProperties.includes(key)).reduce((obj, key) => {

                obj[key] = hash(allData[key], propertyEncodings[key] || throwError(`Encoding information missing for ${key}`))

                return obj;

            }, {});

            const userDocument = {

                userData,
                userIndex

            };


            const paymentDocument = {

                paymentData,
                paymentIndex

            };

            await collections.users.insertOne(userDocument);
            await collections.payments.insertOne(paymentDocument);

            return userID;

        }

    },

    getUserInfo: async (query, queryPropertyName, resultPropertyName) => {

        if (!indexProperties.includes(queryPropertyName) || !propertyEncodings[queryPropertyName]) {

            throw new Error(`${queryPropertyName} does not exist in the user index`);

        }

        const results = await collections.users.find({ [queryPropertyName]: hash(query, propertyEncodings[queryPropertyName]) }).toArray();

        if (results.length == 0) {

            return undefined;

        }

        else if (results.length > 1) {

            throw new Error(`Multiple users with the same ${queryPropertyName} exist.`);

        }

        else {

            const userData = results[0];

            if (userData[resultPropertyName] === undefined) {

                return undefined;

            }

            return decrypt(userData[resultPropertyName], propertyEncodings[resultPropertyName]);

        }

    },

    changeUserInfo: async (query, queryPropertyName, toChangeValue, toChangePropertyName) => {

        const results = await collections.users.find({ [queryPropertyName]: hash(query, propertyEncodings[queryPropertyName] || "base64") }).toArray();

        if (results.length == 0) {

            throw new Error("Cannot find user to modify data.")

        }

        else if (results.length > 1) {

            throw new Error(`Multiple users with the same ${queryPropertyName} exist.`);

        }

        else {

            const userData = results[0];

            if (userData[toChangePropertyName] === undefined) {

                throw new Error(`${toChangePropertyName} does not exist so it cannot be changed.`);

            }

            let processedToChangeValue = toChangeValue;

            if (toChangePropertyName == "passwordHash") {

                processedToChangeValue = passwordHash(toChangeValue + process.env.PASSWORD_PEPPER, decrypt(userData.passwordSalt, "base64"), 64).toString("base64");

            }

            if (toChangePropertyName == "username") {

                if ((await users.find({ usernaeHash: hash(query, "utf-8") }).toArray().length) > 1) {

                    throw new Error("Username already exists.");

                }

                await users.updateOne({ [queryPropertyName]: hash(query, propertyEncodings[queryPropertyName] || "base64") }, { $set: { usernameHash: hash(toChangeValue, "utf-8") } })

            }

            await users.updateOne({ [queryPropertyName]: hash(query, propertyEncodings[queryPropertyName] || "base64") }, { $set: { [toChangePropertyName]: encrypt(processedToChangeValue, propertyEncodings[toChangePropertyName] || "utf-8") } })

        }

    },

    deleteUser : async (username, userID, password) => {

        if (await verifyPassword(username, password)) {

            const userIDHash = hash(userID, "base64");
            const customerID = await getCustomerID(userID, password);

            await stripeAPI.customers.del(customerID);

            await collections.users.deleteOne({ userIDHash });
            await collections.payments.deleteOne({ userIDHash });
            await collections.jwts.deleteMany({ userIDHash });

        }

        else {

            throw new Error("Incorrect password.");

        }

    }

};

const authentication = {

    verifyPassword: async (username, password) => {

        const result = await collections.users.find({ usernameHash: hash(username, "utf-8") }).toArray();

        if (result.length == 0) {

            return false;

        }

        else if (result.length > 1) {

            throw new Error("Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            const userData = result[0];

            return crypto.timingSafeEqual(passwordHash(password + process.env.PASSWORD_PEPPER, decrypt(userData.passwordSalt, "base64"), 64), Buffer.from(decrypt(userData.passwordHash, "base64"), "base64"));

        }

    }

};

const authorization = {

    saveJWTId: async (userID, jwtID) => {

        const userIDHash = hash(userID, "base64");

        const result = await collections.users.find({ userIDHash }).toArray();

        if (result.length == 0) {

            throw "userID is invalid."

        }

        else if (result.length > 1) {

            throw new Error("Multiple users with the same userID exist. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            const jwtIDHash = hash(jwtID, "base64");

            await collections.jwts.insertOne({ userIDHash, jwtIDHash });

        }

    },

    verifyJWTId: async (userID, jwtID) => {

        const userIDHash = hash(userID, "base64");
        const jwtIDHash = hash(jwtID, "base64");

        const result = await collections.jwts.find({ userIDHash, jwtIDHash }).toArray();

        if (result.length == 0) {

            return false;

        }

        else if (result.length > 1) {

            throw new Error("JWT ID is not unique. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            return true;

        }

    }

};

const verification = {

    verifyUserID: async (username, userID) => {

        const result = await collections.users.find({ usernameHash: hash(username, "utf-8") }).toArray();

        if (result.length == 0) {

            return false;

        }

        else if (result.length > 1) {

            throw new Error("Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            const userData = result[0];

            return crypto.timingSafeEqual(Buffer.from(hash(userID, "base64"), "base64"), Buffer.from(userData.userIDHash, "base64"));

        }

    }

};

const payments = {

    createCheckoutSession: async (sessionID, userID, item) => {

        const result = await collections.users.find({ userIDHash: hash(userID, "base64") }).toArray();

        if (result.length == 0) {

            throw new Error("userID does not exist.");

        }

        else if (result.length > 1) {

            throw new Error("Multiple users with the same userID exist. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            collections.checkoutSessions.insertOne({ sessionIDHash: hash(sessionID, "base64"), userID: encrypt(userID, "base64"), item: encrypt(item, "utf-8") });

        }

    },

    getCheckoutSession: async (sessionID) => {

        const result = await collections.checkoutSessions.find({ sessionIDHash: hash(sessionID, "base64") }).toArray()

        if (result.length == 0) {

            throw new Error("Session does not exist or has timed out.");

        }

        else if (result.length > 1) {

            throw new Error("Multiple sessions with the same sessionID exist. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            const userID = decrypt(result[0].userID, "base64");
            const item = decrypt(result[0].item, "utf-8");

            return { userID, item };

        }

    },

    deleteCheckoutSession: async (sessionID) => {

        const result = await collections.checkoutSessions.find({ sessionIDHash: hash(sessionID, "base64") })

        if (result.length == 0) {

            throw new Error("Session does not exist or has timed out.");

        }

        else if (result.length > 1) {

            throw new Error("Multiple sessions with the same sessionID exist. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            await collections.checkoutSessions.deleteOne(result[0])

        }

    },

    addCoursePayment: async (userID, courseName) => {

        const result = await collections.payments.find({ userIDHash: hash(userID, "base64") }).toArray();

        if (result.length == 0) {

            // TODO : refund payment if userID is not found in payments database

        }

        else if (result.length > 1) {

            throw new Error("Multiple users with the same userID exist. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            if (courseNames.includes(courseName)) {

                let courseData = result[0].courses ? result[0].courses : {};

                courseData[courseName] = true;

                await collections.payments.updateOne({ userIDHash: hash(userID, "base64") }, { $set: { courses: courseData } })

            }

        }

    },

    updateSubID: async (customerID, newSubID) => {

        const result = await collections.payments.find({ stripeCustomerIDHash: hash(customerID, "utf-8") }).toArray();

        if (result.length == 0) {

            // TODO : refund payment if userID is not found in payments database

        }

        else if (result.length > 1) {

            throw new Error("Multiple users with the same userID exist. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            await collections.payments.updateOne({ stripeCustomerIDHash: hash(customerID, "utf-8") }, { $set: { subID: newSubID } });

        }

    },

    checkIfPaidFor: async (userID, courseName) => {

        const result = await collections.payments.find({ userIDHash: hash(userID, "base64") }).toArray();

        if (result.length == 0) {

            return false;

        }

        else if (result.length > 1) {

            throw new Error("Multiple users with the same userID exist. THIS SHOULD NOT NORMALLY HAPPEN.");

        }

        else {

            const paymentData = result[0];

            if (paymentData.subID) {

                const subscription = await stripeAPI.subscriptions.retrieve(paymentData.subID);

                if (subscription.status == "active") {

                    return true;

                }

            }

            const courseData = paymentData.courses;

            return courseData && courseData[courseName];

        }

    }

};

module.exports = {
    
    users,
    authentication,
    authorization,
    verification,
    payments

};