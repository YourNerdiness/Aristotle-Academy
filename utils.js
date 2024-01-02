import crypto from "crypto"
import fs from "fs"

const errorCodes = JSON.parse(fs.readFileSync("error_codes.json"));
const bannedPasswordRegexPatterns = fs.readFileSync("password_regex_blacklist.txt").toString("utf-8").split("\n");

const createLog = async (msg, severity) => {

    console.log(`${severity} : ${msg}`);

}

class ErrorHandler {

    constructor(errorCode, additionalMessage="") {

        this.errorCode = errorCode;
        this.msg = errorCodes[errorCode].msg + " " + additionalMessage;
        this.userMsg = additionalMessage || errorCodes[errorCode].msg;
        this.httpErrorCode = errorCodes[errorCode].http_error_code;
        this.severity = errorCodes[errorCode].severity

        createLog(this.errorCode + "-" + this.msg, this.severity);

    }
    
    throwError() {

        throw this;

    }

    throwErrorToClient(res) {

        try {

            res.status(this.httpErrorCode).json(this);

        }

        catch (error) {

            createLog("Could not send error to client.", "ERROR");

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

        new utils.ErrorHandler("0x000040", await res.text()).throwError();

    }

    const data = await res.text();

    const passwordSuffixes = data.split("\n").map(elem => elem.split(":")[0]);

    return passwordSuffixes.includes(hashSuffix) ? 4 : 0;

};

const sendEmail = async (transport, subject, content, to, useTemplate=true, name="") => {

    if (name && !useTemplate) {

        new ErrorHandler("0x00003E", "Recipient name was provided but template was disabled.").throwError();

    }

    try {

        let html = "";

        if (useTemplate) {

            html = `
            
            <section style="background-color: rgb(64, 64, 64); color: white;">
            
            <h1>Hi ${name}, </h1> 
            ${content} 
            <h3>Thanks, <br> Aristotle Academy</h3>
            
            </section>`

        }

        else {

            html = content;

        }

        await transport.sendMail({
            
            to,
            subject,
            html


        });

    }

    catch (error) {

        new ErrorHandler("0x000041", error).throwError();

    }

};

export default {

    hash,
    passwordHash,
    encrypt,
    decrypt,
    createLog,
    ErrorHandler,
    filterChildProperties,
    checkNewPassword,
    sendEmail
}