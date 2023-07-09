const crypto = require("crypto");
const { MongoClient, ServerApiVersion } = require('mongodb');
const stripe = require("stripe");
const fs = require("fs");
const ms = require("ms");

require("dotenv").config();

const stripeAPI = stripe(process.env.STRIPE_SK);

const mongodbURI = `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@${process.env.MONGODB_HOSTNAME}/?retryWrites=true&w=majority`;

const client = new MongoClient(mongodbURI, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

let db;

let users;
let payments;
let jwts;

let courseData;
let courseNames;
let defaultCoursePaymentData;

const hash = (data, encoding) => {

    return crypto.createHash(process.env.HASHING_ALGORITHM).update(data, encoding);

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

    return { content : output, encryptionSalt, iv : iv.toString("base64"), authTag : cipher.getAuthTag().toString("base64") };

};

const decrypt = (encryptionData, encoding) => {

    const key = passwordHash(process.env.AES_KEY, encryptionData.encryptionSalt, 32);

    const decipher = crypto.createDecipheriv(process.env.ENCRYPTION_ALGORITHM, Buffer.from(key, "base64"), Buffer.from(encryptionData.iv, "base64"));
    
    decipher.setAuthTag(Buffer.from(encryptionData.authTag, "base64"));

    const output = decipher.update(encryptionData.content, "base64", encoding) + decipher.final(encoding);

    return output;

};

const init = async () => {

    await client.connect();

    db = client.db(process.env.MONGODB_DB_NAME);

    users = db.collection("users");
    payments = db.collection("payments");
    jwts = db.collection("jwts");

    jwts.createIndex({ createdAt: 1 }, { expireAfterSeconds: ms(process.env.JWT_EXPIRES)/1000 });

    courseData = JSON.parse(fs.readFileSync("course_data.json")); 
    courseNames = Object.keys(courseData);
    defaultCoursePaymentData = {};

    for (const courseName in courseNames) {

        defaultCoursePaymentData[courseName] = false;

    }

    defaultCoursePaymentData = encrypt(JSON.stringify(defaultCoursePaymentData), "utf-8");

};

const addNewUser = async (username, email, password) => {

    const result = await users.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

    if (result.length == 1) {

        throw new Error("Username is taken.");

    }

    else if (result.length > 1) {

        throw new Error("Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.");

    }

    else {

        let customer;

        try {

            customer = await stripeAPI.customers.create({

                name: username,
                email

            });

        } catch (error) {

            switch (error.raw.code) {

                case "email_invalid":

                    throw "Please enter a valid email."
            
                default:

                    throw error.raw.code;

            }

        }

        const userID = crypto.randomBytes(256).toString("base64");

        const usernameHash = hash(username, "utf-8").digest("base64"); 
        const userIDHash = hash(userID, "base64").digest("base64");

        const passwordSalt = crypto.randomBytes(Number(process.env.SALT_SIZE)).toString("base64");

        const passwordDigest = passwordHash(password + process.env.PASSWORD_PEPPER, passwordSalt, 64).toString("base64");

        const userData = {

                            userID : encrypt(userID, "base64"),
                            stripeCustomerID : encrypt(customer.id, "utf-8"), 
                            username : encrypt(username, "utf-8"),
                            email : encrypt(email, "utf-8"), 
                            passwordHash : encrypt(passwordDigest, "base64"),
                            passwordSalt : encrypt(passwordSalt, "base64"),
                            usernameHash,
                            userIDHash

                        };

        await users.insertOne(userData);

        const paymentData = { 
        
            userIDHash, 
            sub_id : null, 
            courses : defaultCoursePaymentData 
        
        };

        await payments.insertOne( paymentData );

        return userID;

    }

};

const verifyPassword = async (username, password) => {

    const result = await users.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

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

};

const verifyUserID = async (username, userID) => {

    const result = await users.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

    if (result.length == 0) {

        return false;

    }

    else if (result.length > 1) {

        throw new Error("Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.");

    }

    else {

        const userData = result[0];

        return crypto.timingSafeEqual(Buffer.from(hash(userID, "base64").digest("base64"), "base64"), Buffer.from(userData.userIDHash, "base64"))

    }

}

const getUserID = async (username) => {

    const result = await users.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

    if (result.length == 0) {

        return undefined;

    }

    else if (result.length > 1) {

        throw new Error("Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.");

    }

    else {

        const userData = result[0];

        return 

    }

};

const getCustomerID = async (userID, password) => {

    const result = await users.find({ userIDHash : hash(userID, "base64").digest("base64") }).toArray();

    if (result.length == 0) {

        return undefined;

    }

    else if (result.length > 1) {

        throw new Error("Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.");

    }

    else {

        const userData = result[0];

        if (crypto.timingSafeEqual(passwordHash(password + process.env.PASSWORD_PEPPER, decrypt(userData.passwordSalt, "base64"), 64), Buffer.from(decrypt(userData.passwordHash, "base64"), "base64"))) {

            return decrypt(userData.stripeCustomerID, "utf-8");

        }

        else {

            return null;

        }

    }

}

const addCoursePayment = async (userID, courseName) => {};

const checkIfPaidFor = async (userID, courseName) => {

    const result = await payments.find({ userIDHash : hash(userID, "base64").digest("base64") }).toArray();

    if (result.length == 0) {

        return false;

    }

    else if (result.length > 1) {

        throw new Error("Multiple users with the same userID exist. THIS SHOULD NOT NORMALLY HAPPEN.");

    }

    else {

        const courseData = JSON.parse(decrypt(result[0].courses, "utf-8"));

        return (!!(courseData[courseName])) && courseData[courseName].paidFor;

    }

};

const saveJWTId = async (userID, jwtID) => {

    const userIDHash = hash(userID, "base64").digest("base64");

    const result = await users.find({ userIDHash }).toArray();

    if (result.length == 0) {

        throw "Username is invalid."

    }

    else if (result.length > 1) {

        throw new Error("Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.");

    }

    else {

        const jwtIDHash = hash(jwtID, "base64").digest("base64");

        await jwts.insertOne({ userIDHash, jwtIDHash });

    }

};

const verifyJWTId = async (userID, jwtID) => {

    const userIDHash = hash(userID, "base64").digest("base64");
    const jwtIDHash = hash(jwtID, "base64").digest("base64");

    const result = await jwts.find({ userIDHash, jwtIDHash }).toArray();

    if (result.length == 0) {

        return false;

    }

    else if (result.length > 1) {

        throw new Error("JWT ID is not unique. THIS SHOULD NOT NORMALLY HAPPEN.");

    }

    else {

        return true;

    }

};

module.exports = {

    init,
    addNewUser,
    verifyPassword,
    verifyUserID,
    getUserID,
    getCustomerID,
    checkIfPaidFor,
    saveJWTId,
    verifyJWTId

};