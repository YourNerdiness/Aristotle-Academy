import crypto from "crypto"
import fs from "fs"

const errorCodes = JSON.parse(fs.readFileSync("error_codes.json"));

const createLog = async (msg, severity, errorCode) => {

    console.log(`${severity} - ${errorCode}: ${msg}`);

}

class ErrorHandler {

    constructor(errorCode, additionalMessage="") {

        this.errorCode = errorCode;
        this.msg = errorCodes[errorCode].msg + " " + additionalMessage;
        this.userMsg = additionalMessage || errorCodes[errorCode].msg;
        this.httpErrorCode = errorCodes[errorCode].http_error_code;
        this.severity = errorCodes[errorCode].severity

        createLog(this.msg, this.severity, this.errorCode);

    }

    throwError() {

        throw this;

    }

    throwErrorToClient(res) {

        try {

            res.status(this.httpErrorCode).json(this);

        }

        catch (error) {

            createLog("Could not send error to client.", "ERROR", "0x000000");

        }

    }

}

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
    ErrorHandler,
    filterChildProperties

}