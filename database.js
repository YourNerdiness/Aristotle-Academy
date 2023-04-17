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
let courses;
let jwts;

let courseData;
let courseNames;

const init = async () => {

    await client.connect();

    db = client.db(process.env.MONGODB_DB_NAME);

    users = db.collection("users");
    courses = db.collection("courses");
    jwts = db.collection("jwts");

    jwts.createIndex({ createdAt: 1 }, { expireAfterSeconds: ms(process.env.JWT_EXPIRES)/1000 });

    courseData = JSON.parse(fs.readFileSync("course_data.json")); 
    courseNames = Object.keys(courseData);

};

const hash = (data, encoding) => {

    return crypto.createHash(process.env.HASHING_ALGORITHM).update(data, encoding);

};

const passwordHash = (password, salt, size) => {

    return crypto.scryptSync(password, salt, size);

};

const encrypt = (content, encoding) => {

    const encryptionSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");

    const key = passwordHash(process.env.DATABASE_AES_KEY, encryptionSalt, 32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(process.env.DATABASE_ENCRYPTION_ALGORITHM, key, iv);

    const output = cipher.update(content, encoding, "base64") + cipher.final("base64");

    return { content : output, encryptionSalt, iv : iv.toString("base64"), authTag : cipher.getAuthTag().toString("base64") };

};

const decrypt = (encryptionData, encoding) => {

    const key = passwordHash(process.env.DATABASE_AES_KEY, encryptionData.encryptionSalt, 32);

    const decipher = crypto.createDecipheriv(process.env.DATABASE_ENCRYPTION_ALGORITHM, Buffer.from(key, "base64"), Buffer.from(encryptionData.iv, "base64"));
    
    decipher.setAuthTag(Buffer.from(encryptionData.authTag, "base64"));

    const output = decipher.update(encryptionData.content, "base64", encoding) + decipher.final(encoding);

    return output;

};

const addNewUser = async (username, email, password) => {

    const result = await users.find({ usernameHash : hash(username, "utf-8").digest("base64") });

    if (result.length == 1) {

        throw "Username is taken."

    }

    else if (result.length > 1) {

        throw "Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.";

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

        const passwordSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");

        const passwordDigest = passwordHash(password, passwordSalt, 64).toString("base64");

        const userData = {

                            userID : encrypt(userID, "base64"),
                            stripeCustomerID : encrypt(customer.id, "base64"), 
                            username : encrypt(username, "utf-8"),
                            usernameHash : usernameHash,
                            email : encrypt(email, "utf-8"), 
                            passwordHash : encrypt(passwordDigest, "base64"),
                            passwordSalt : encrypt(passwordSalt, "base64")

                        };

        await users.insertOne(userData);

        const userCourseData = { usernameHash, courses : {} };

        for (let i = 0; i < courseNames.length; i++) {

            userCourseData.courses[courseNames[i]] = { paidFor : false, lessonData : null };

        }

        userCourseData.courses = encrypt(JSON.stringify(userCourseData.courses), "utf-8");

        await courses.insertOne( userCourseData );

        return userID;

    }

};

const verifyUserID = async (username, userID) => {

    const result = await users.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

    if (result.length == 0) {

        return false;

    }

    else if (result.length > 1) {

        throw "Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.";

    }

    else {

        return crypto.timingSafeEqual(Buffer.from(userID), Buffer.from(decrypt(userData.userID, "base64"), "base64"))

    }

}

const getUserID = async (username, password) => {

    const result = await users.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

    if (result.length == 0) {

        return undefined;

    }

    else if (result.length > 1) {

        throw "Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.";

    }

    else {

        const userData = result[0];

        if (crypto.timingSafeEqual(passwordHash(password, decrypt(userData.passwordSalt, "base64"), "base64"), Buffer.from(decrypt(userData.passwordHash, "base64"), "base64"))) {

            return decrypt(userData.userID, "base64");

        }

        else {

            return null;

        }

    }

};

const getCustomerID = async (username, password) => {

    const result = await users.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

    if (result.length == 0) {

        return undefined;

    }

    else if (result.length > 1) {

        throw "Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.";

    }

    else {

        const userData = result[0];

        if (crypto.timingSafeEqual(passwordHash(password, decrypt(userData.passwordSalt, "base64"), 64), Buffer.from(decrypt(userData.hashedPassword, "base64"), "base64"))) {

            return decrypt(userData.stripeCustomerID, "base64");

        }

        else {

            return null;

        }

    }

}

const checkIfPaidFor = async (courseName, username) => {

    const result = await courses.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

    if (result.length == 0) {

        return false;

    }

    else if (result.length > 1) {

        throw "Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.";

    }

    else {

        const result = result[0];

        const courseData = JSON.parse(decrypt(result.courses, "utf-8"));

        return (!!(courseData[courseName])) && courseData[courseName].paidFor;

    }

};

const saveJWTId = async (username, jwtID) => {

    const result = await users.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

    if (result.length == 0) {

        throw "Username is invalid."

    }

    else if (result.length > 1) {

        throw "Multiple users with the same username exist. THIS SHOULD NOT NORMALLY HAPPEN.";

    }

    else {

        const obj = {};

        obj[hash(username, "utf-8")] = hash(jwtID, "base64");

        await jwts.insertOne(obj);

    }

};

const verifyJWTId = async (username, jwtID) => {

    const obj = {};

    obj[hash(username, "utf-8")] = hash(jwtID, "base64");

    const jwtIDs = await jwts.find(obj);

    if (result.length == 0) {

        return false;

    }

    else if (result.length > 1) {

        throw "JWT ID is not unique. THIS SHOULD NOT NORMALLY HAPPEN.";

    }

    else {

        return true;

    }

};

module.exports = {

    init,
    addNewUser,
    verifyUserID,
    getUserID,
    getCustomerID,
    checkIfPaidFor,
    saveJWTId,
    verifyJWTId

};