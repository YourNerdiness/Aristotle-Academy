import crypto from "crypto"
import utils from "./utils.js"
import database from "./database.js";

let courseData, topicData;

const updateConfig = async () => {

    courseData = await database.config.getConfigData("course_data");
    topicData = await database.config.getConfigData("topic_data");

};

await updateConfig();

class QLearning {

    constructor (possibleActions) {

        this.lambda = 1;
        this.possibleActions = possibleActions;
        this.getDefaultActionValues = (discourageAction) => { return possibleActions.reduce((obj, key) => { obj[key] = (key == discourageAction ? (Math.random()/50) : (Math.random()/50)); return obj; }, {}) };

    }

    _normalizeVector (vector) {

        const scalerSum = vector.reduce((acc, val) => acc + val, 0);

        const newVector = [];

        for (let i = 0; i < vector.length; i++) {

            newVector[i] = vector[i] / scalerSum;

        }

        return newVector;

    }

    async _calculateQValues (reward, state, action, learningRate) {

        if (!(await database.ai.getStateObj(state.split("|")[0], state.split("|")[1]))) {

            await database.ai.setStateObj(state.split("|")[0], state.split("|")[1], this.getDefaultActionValues(Number(state.split("|")[1]) < 3 ? "e" : ""));

        }

        let oldQValue = await database.ai.getQValue(state.split("|")[0], state.split("|")[1], action) || 0.0;

        return oldQValue + learningRate * (reward - oldQValue);

    }

    // stateActionPairs is an array of state-action pairs, representing the actions taken in the states before the reward was received. stateActionPairs[0] is the most recent state-action pair, where the reward was received, stateActionPairs[1] is the second most recent state-action pair, etc
    async updateQValues (stateActionPairs, reward, learningRate) {
        
        const promises = [];

        for (let i = 0; i < stateActionPairs.length; i++) {

            promises.push(this._calculateQValues(this.lambda**i*reward, stateActionPairs[i][0], stateActionPairs[i][1], learningRate)
                .then(newQValue => { return database.ai.setQValue(stateActionPairs[i][0].split("|")[0], stateActionPairs[i][0].split("|")[1], stateActionPairs[i][1], newQValue) }));

        }

        await Promise.all(await Promise.all(promises))

    }

    async selectAction (state) {

        // TODO: make for for negative rewards, potentially in normalization code

        if (!(await database.ai.getStateObj(state.split("|")[0], state.split("|")[1]))) {

            await database.ai.setStateObj(state.split("|")[0], state.split("|")[1], this.getDefaultActionValues(Number(state.split("|")[1]) < 3 ? "e" : ""));

        }

        const actionRewards = await database.ai.getStateObj(state.split("|")[0], state.split("|")[1]);

        const rewards = Object.values(actionRewards);
        const normalizedRewards = this._normalizeVector(rewards);

        for (let i = 0; i < rewards.length; i++) {

            const actionRewardsKey = Object.keys(actionRewards).find((key) => actionRewards[key] == rewards[i]);

            actionRewards[actionRewardsKey] = normalizedRewards[i];

        }

        const selectNum = Math.random();
        let acc = 0;

        let selectedAction;

        for (let action of this.possibleActions) {

            if (selectNum >= acc) {

                selectedAction = action;

            }

            acc += actionRewards[action];

        }

        return selectedAction;

    }

}

const qLearning = new QLearning(["v", "p", "e"]) // video, paragraph, and exercise respectively

const getContentID = async (userID, courseID) => {

    await updateConfig();

    const userIDHash = utils.hash(userID, "base64");

    const chunksPerLessonProm = database.ai.getUserNumChunks(userID);

    const completedTopics = await database.topics.getCompletedTopics(userID);

    if (courseData[courseID].topics.length == 0) {

        new utils.ErrorHandler("0x000058").throwError();

    }

    if (courseData[courseID].topics.filter(elem => !completedTopics.includes(elem)).length == 0) {

        new utils.ErrorHandler("0x000059").throwError();

    }

    const topicID = courseData[courseID].topics.filter(elem => !completedTopics.includes(elem))[0];

    const currentLessonChunkProm = database.topics.getLessonChunk(userID, topicID);

    const currentLessonChunk = await currentLessonChunkProm;
    const chunksPerLesson = await chunksPerLessonProm;

    let contentRoute;

    if (currentLessonChunk >= Math.max(topicData[topicID].minChunks, Math.min(chunksPerLesson - 1, topicData[topicID].maxChunks))) {

        contentRoute = `/${topicID}/quiz.json`;

    }

    else {

        const state = userIDHash + "|" + currentLessonChunk.toString();

        const contentFormat = await qLearning.selectAction(state);

        let filename;

        switch (contentFormat) {

            case "v":

                filename = "video.mp4"

                break;

            case "p":

                filename = "text.md"

                break;

            case "e":

                filename = "exercise.json"

                break;

            default:

                new utils.ErrorHandler("0x000042", "Invalid action returned from q-learning").throwError();

                break;

        }

        contentRoute = `/${topicID}/${currentLessonChunk.toString()}/${filename}`

        await database.topics.setChunkContentFormat(userID, topicID, currentLessonChunk, contentFormat);

    }

    const signature = utils.hashHMAC(contentRoute, "base64url")

    return contentRoute + "|" + signature;

};

const updateAI = async (userID, topicID, quizScore, summedSessionTimes) => {

    const actions = (await database.topics.getLessonChunkContentFormats(userID, topicID)).reverse();
    const userIDHash = utils.hash(userID, "base64");

    const stateActionPairs = [];

    for (let i = 0; i < actions.length; i++) {

        stateActionPairs.push([userIDHash + "|" + i.toString(), actions[i] || new utils.ErrorHandler("0x00003F").throwError()])

    }

    const completedTopics = await database.topics.getCompletedTopics(userID);

    const updateQValuesProm = qLearning.updateQValues(stateActionPairs, quizScore, Math.max(1 / (completedTopics.length || 1), 0.05));

    let setUserNumChunksProm;

    if (summedSessionTimes > 3600000) { // 1 hour per lesson

        if (quizScore > 0.85 && currentUserNumChunks > 1) {

            const currentUserNumChunks = await database.ai.getUserNumChunks(userID);

            setUserNumChunksProm = database.ai.setUserNumChunks(userID, currentUserNumChunks - 1);

        }

    }

    else {

        if (quizScore < 0.65) {

            const currentUserNumChunks = await database.ai.getUserNumChunks(userID);

            setUserNumChunksProm = database.ai.setUserNumChunks(userID, currentUserNumChunks + 1);
    
        }

    }

    await updateQValuesProm;

    if (setUserNumChunksProm) {

        await setUserNumChunksProm;
        
    }

}

export default {

    getContentID,
    updateAI

}