const errorCodes = JSON.parse(fs.readFileSync("error_codes.json")); 

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

const createLog = async (msg, severity) => {

    console.log(`${severity}: ${msg}`);

}

const throwError = (errorCode, additionalMessage="") => {

    if (errorCode == "0x000000" || !errorCodes[errorCode]) {

        throw { msg : additionalMessage, http_error_code : 500 }

    }

    const errorObj = errorCodes[errorCode];

    errorObj.msg += "" + additionalMessage;

    createLog(errorObj.msg, errorObj.severity);

    throw errorObj;

};

const filterChildProperties = (obj, property) => {

    const keys = Object.keys(obj);

    const toReturn = {};

    for (let i = 0; i < keys.length; i++) {

        toReturn[keys[i]] = obj[keys[i]][property];

    }

    return toReturn;

};

export default {

    hash,
    passwordHash,
    encrypt,
    decrypt,
    createLog,
    throwError,
    filterChildProperties

}