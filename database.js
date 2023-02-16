const crypto = require("crypto");
const MongoClient = require("mongodb").MongoClient;
const stripe = require("stripe");

require("dotenv").config();

const stripeAPI = stripe(process.env.STRIPE_SK);

const client = new MongoClient(process.env.MONGO_HOST);
let db;

let users;
let courses;

let courseData;
let courseNames;

const init = async () => {

    await client.connect();

    db = client.db(process.env.MONGO_DB_NAME);

    users = db.collection("users");
    courses = db.collection("courses");

    courseData = JSON.parse(fs.readFileSync("course_data.json")); 
    courseNames = Object.keys(courseData);

};

const errorLog = (message) => {

    console.error(Date.now(), message);

    throw message;

};

const hash = (data, encoding) => {

    return crypto.createHash(process.env.HASHING_ALGORITHM).update(data, encoding);

};

const passwordHash = (password, salt, size) => {

    return crypto.scryptSync(password, salt, size);

};

const verificationHash = (data, key, encoding) => {

    return crypto.createHmac(process.env.HASHING_ALGORITHM, Buffer.from(key)).update(data, encoding);

}

const encrypt = (content, encoding) => {

    const encryptionSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");

    const key = passwordHash(process.env.DATABASE_AES_KEY, encryptionSalt, 32);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(process.env.DATABASE_ENCRYPTION_ALGORITHM, key, iv);

    let output = cipher.update(content, encoding, "base64");
    output += cipher.final("base64");

    return { content : output, encryptionSalt, iv : iv.toString("base64"), authTag : cipher.getAuthTag().toString("base64") };

};

const decrypt = (encryptionData, encoding) => {

    const key = passwordHash(process.env.DATABASE_AES_KEY, encryptionData.encryptionSalt, 32);

    const decipher = crypto.createDecipheriv(process.env.DATABASE_ENCRYPTION_ALGORITHM, Buffer.from(key, "base64"), Buffer.from(encryptionData.iv, "base64"));
    
    decipher.setAuthTag(Buffer.from(encryptionData.authTag, "base64"));

    let output = decipher.update(encryptionData.content, "base64", encoding);
    output += decipher.final(encoding);

    return output;

};

const encryptCTR = (content, key, encoding) => {

    const cipher = crypto.createCipheriv("aes-256-ctr", key, Buffer.from(process.env.DATABASE_AES_CTR_IV, "hex"));

    let output = cipher.update(content, encoding, "base64");
    output += cipher.final("base64");

    return output;

};

const decryptCTR = (content, key, encoding) => {

    const decipher = crypto.createDecipheriv("aes-256-ctr", key, Buffer.from(process.env.DATABASE_AES_CTR_IV, "hex"));
    
    let output = decipher.update(content, "base64", encoding);
    output += decipher.final(encoding);

    return output;

};

const checkIfUserExists = async (username, email, userID) => {

    const filter = [];

    if (username) {

        filter.push({ usernameHash : hash(username, "utf-8").digest("base64") });

    }

    if (email) {

        filter.push({ email });

    }

    if (userID) {

        filter.push({ userID });

    }

    const result = await users.find({ $or: filter }).toArray();

    if (result.length == 0) {

        return false;

    }

    else if (result.length == 1) {

        return true;

    }

    else {

        errorLog("Multiple users with similar details exist.")

        return true;

    }

};

const addNewUser = async (username, email, password) => {

    if (await checkIfUserExists(username, email, null)) {

        errorLog("User Already Exists");

    }

    const passwordSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");

    const passwordHash = passwordHash(password, passwordSalt, 64).toString("base64");

    let customer;

    try {

        customer = await stripeAPI.customers.create({

            name: username,
            email

        });

    } catch (error) {

        switch (error.raw.code) {

            case "email_invalid":

                errorLog("Email is not valid.")

                break;
            
            default:

                errorLog(error.raw.code);

                break;

        }

    }

    const userID = crypto.randomBytes(256).toString("base64");

    const userIDSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");
    const stripeCustomerIDSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");

    const userIDKey = passwordHash(password, userIDSalt, 32);
    const stripeCustomerIDKey = passwordHash(password, stripeCustomerIDSalt, 32);

    const userData = {

                       userID : encrypt(encryptCTR(userID, userIDKey, "base64"), "base64"), 
                       stripeCustomerID : encrypt(encryptCTR(customer.id, stripeCustomerIDKey, "utf-8"), "base64"), 
                       username : encrypt(username, "utf-8"),
                       usernameHash : hash(username, "utf-8").digest("base64"),
                       email : encrypt(email, "utf-8"), 
                       passwordHash : encrypt(passwordHash, "base64"),
                       passwordSalt : encrypt(passwordSalt, "base64"),
                       userIDSalt :  encrypt(userIDSalt, "base64"),
                       stripeCustomerIDSalt : encrypt(stripeCustomerIDSalt, "base64"),

                    };

    await users.insertOne(userData);

    const userIDHashSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");

    const userCourseData = { usernameHash : hash(username, "utf-8").digest("base64"), userIDHash : passwordHash(userID, userIDHashSalt, 64).toString("base64"), userIDHashSalt };

    for (let i = 0; i < courseNames.length; i++) {

        userCourseData[courseNames[i]] = { paidFor : false, lessonData : null };

    }

    await courses.insertOne({ userCourseData, verification : verificationHash(JSON.stringify(userCourseData), userID).toString("base64") });

    return userID;

};

const getUserID = async (username, password) => {

    const result = await users.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

    if (result.length == 0) {

        return undefined;

    }

    else if (result.length > 1) {

        errorLog("Multiple users with the same username exist.");

    }

    else {

        const userData = result[0];

        if (crypto.timingSafeEqual(passwordHash(password, decrypt(userData.passwordSalt, "base64"), "base64"), Buffer.from(decrypt(userData.passwordHash, "base64"), "base64"))) {

            const CTRKey = passwordHash(password, decrypt(userData.userIDSalt, "base64"), 32);

            return decryptCTR(decrypt(userData.userID, "base64"), CTRKey, "base64");

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

        errorLog("Multiple users with the same username exist.");

    }

    else {

        const userData = result[0];

        if (crypto.timingSafeEqual(passwordHash(password, decrypt(userData.passwordSalt, "base64"), 64), Buffer.from(decrypt(userData.hashedPassword, "base64"), "base64"))) {

            const CTRKey = passwordHash(password, decrypt(userData.stripeCustomerIDSalt, "base64"), 32);

            return decryptCTR(decrypt(userData.stripeCustomerID, "base64"), CTRKey, "utf-8");

        }

        else {

            return null;

        }

    }

}

const checkIfPaidFor = async (courseName, username, userID) => {

    const result = await courses.find({ usernameHash : hash(username, "utf-8").digest("base64") }).toArray();

    if (result.length == 0) {

        return false;

    }

    else if (result.length > 1) {

        errorLog("Multiple users with the same username exist.");

        return false;

    }

    else {

        const result = result[0];

        const courseData = result.userCourseData;

        if (userID) {

            if(!crypto.timingSafeEqual(verificationHash(JSON.stringify(courseData), userID), Buffer.from(result.verification))) {

                throw "Verifcation failed. THIS SHOULD NOT NORMALLY HAPPEN. User's course data has been modified without their permission.";

            }

        }

        return (!!(courseData[courseName])) && courseData[courseName].paidFor;

    }

};

module.exports = {

    init,
    checkIfUserExists,
    addNewUser,
    getUserID,
    getCustomerID,
    checkIfPaidFor

};