const crypto = require("crypto");
const MongoClient = require("mongodb").MongoClient;
const stripe = require("stripe");

require("dotenv").config();

const stripeAPI = stripe(process.env.STRIPE_SK);

const client = new MongoClient(process.env.MONGO_HOST);
let db;

let users;
let content;

const init = async () => {

    await client.connect();

    db = client.db(process.env.MONGO_DB_NAME);

    users = db.collection("users");
    content = db.collection("content");

};

const errorLog = (message) => {

    console.error(Date.now(), message);

    throw message;

};

const hash = (data, encoding) => {

    return crypto.createHash(process.env.HASHING_ALGORITHM).update(data, encoding).digest("base64");

};

const passwordHash = (password, salt, size) => {

    return crypto.scryptSync(password, salt, size);

};

const encrypt = (content, key, encoding) => {

    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(process.env.DATABASE_ENCRYPTION_ALGORITHM, key, iv);

    let output = cipher.update(content, encoding, "base64");
    output += cipher.final("base64");

    return { content : output, iv : iv.toString(), authTag : cipher.getAuthTag().toString("base64") };

};

const decrypt = (content, key, iv, authTag, encoding) => {

    const decipher = crypto.createDecipheriv(process.env.DATABASE_ENCRYPTION_ALGORITHM, key, iv);
    
    decipher.setAuthTag(Buffer.from(authTag, "base64"));

    let output = decipher.update(content, "base64", encoding);
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

        filter.push({ username });

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

    const hashedPassword = passwordHash(password, passwordSalt, 64).toString("base64");

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

    let userID;

    while ((!userID) || (await checkIfUserExists(null, null, userID))) {
        
        userID = crypto.randomInt(0, (2 ** 48) - 1).toString(16) +
                 crypto.randomInt(0, (2 ** 48) - 1).toString(16) +
                 crypto.randomInt(0, (2 ** 48) - 1).toString(16) +
                 crypto.randomInt(0, (2 ** 48) - 1).toString(16) +
                 crypto.randomInt(0, (2 ** 48) - 1).toString(16) +
                 crypto.randomInt(0, (2 ** 48) - 1).toString(16) +
                 crypto.randomInt(0, (2 ** 48) - 1).toString(16) +
                 crypto.randomInt(0, (2 ** 48) - 1).toString(16);
                 
    }

    const encryptionSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");
    const userIDSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");
    const stripeCustomerIDSalt = crypto.randomBytes(+process.env.DATABASE_SALT_SIZE).toString("base64");

    const encryptionKey = passwordHash(process.env.DATABASE_AES_KEY, encryptionSalt, 32);
    const userIDKey = passwordHash(password, userIDSalt, 32);
    const stripeCustomerIDKey = passwordHash(password, stripeCustomerIDSalt, 32);

    const userData = {  
                       userID : encrypt(encryptCTR(userID, userIDKey, "base64"), encryptionKey, "base64"), 
                       stripeCustomerID : encrypt(encryptCTR(customer.id, stripeCustomerIDKey, "utf-8"), encryptionKey, "base64"), 
                       username,
                       email : encrypt(email, encryptionKey, "utf-8"), 
                       hashedPassword : encrypt(hashedPassword, encryptionKey, "base64"),
                       encryptionSalt,
                       passwordSalt : encrypt(passwordSalt, encryptionKey, "base64"),
                       userIDSalt :  encrypt(userIDSalt, encryptionKey, "base64"),
                       stripeCustomerIDSalt : encrypt(stripeCustomerIDSalt, encryptionKey, "base64"),
                    };

    await users.insertOne(userData);

    await content.insertOne({ userIDHash : hash(userID, "base64") })

    return userID;

};

const getUserID = async (username, password) => {

    const result = await users.find({ username }).toArray();

    if (result.length == 0) {

        return undefined;

    }

    else if (result.length > 1) {

        errorLog("Multiple users with similar details exist.");

    }

    else {

        const userData = result[0];

        const key = passwordHash(process.env.DATABASE_AES_KEY, userData.encryptionSalt, 32);

        if (crypto.timingSafeEqual(passwordHash(password, decrypt(userData.passwordSalt.content, key, userData.passwordSalt.iv, userData.passwordSalt.authTag), 64), Buffer.from(decrypt(userData.hashedPassword.content, key, userData.hashedPassword.iv, userData.hashedPassword.authTag, "base64"), "base64"))) {

            const CTRKey = passwordHash(password, userData.userIDSalt, 32);

            return decryptCTR(decrypt(userData.userID.content, key, userData.userID.iv, userData.userID.authTag, "base64"), CTRKey, "base64");

        }

        else {

            return null;

        }

    }

};

const getCustomerID = async (username, password) => {

    const result = await users.find({ username }).toArray();

    if (result.length == 0) {

        return undefined;

    }

    else if (result.length > 1) {

        errorLog("Multiple users with similar details exist.");

    }

    else {

        const userData = result[0];

        const key = passwordHash(process.env.DATABASE_AES_KEY, userData.encryptionSalt, 32);

        if (crypto.timingSafeEqual(passwordHash(password, decrypt(userData.passwordSalt.content, key, userData.passwordSalt.iv, userData.passwordSalt.authTag, "base64"), 64), Buffer.from(decrypt(userData.hashedPassword.content, key, userData.hashedPassword.iv, userData.hashedPassword.authTag, "base64"), "base64"))) {

            const CTRKey = passwordHash(password, decrypt(userData.stripeCustomerIDSalt.content, key, userData.stripeCustomerIDSalt.iv, userData.stripeCustomerIDSalt.authTag, "base64"), 32);

            return decryptCTR(decrypt(userData.stripeCustomerID.content, key, userData.stripeCustomerID.iv, userData.stripeCustomerID.authTag, "base64"), CTRKey, "utf-8");

        }

        else {

            return null;

        }

    }

}

const getLessonList = async (contentName, userID) => {

    const result = await content.find({ userIDHash : hash(userID, "base64") }).toArray();

    if (result.length == 0) {

        return [];

    }

    else if (result.length > 1) {

        errorLog("Multiple users with similar details exist.");

    }

    else {

        const contentData = result[0];

        if (contentData[contentName] == undefined) {

            return [];

        }

        else {

            return contentData[contentName];

        }

    }


};

module.exports = {

    init,
    checkIfUserExists,
    addNewUser,
    getUserID,
    getCustomerID,
    getLessonList

};