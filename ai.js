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

        this.alpha = 0.3;
        this.epsilon = 0.05;
        this.lambda = 0.99;
        this.possibleActions = possibleActions;
        this.getDefaultActionValues = (discourageAction) => { return possibleActions.reduce((obj, key) => { obj[key] = Math.random()/(key == discourageAction ? 35 : 20); return obj; }, {}) };

    }

    async calculateQValues (reward, state, action) {

        if (!(await database.ai.getStateObj(state.split("|")[0], state.split("|")[1]))) {

            await database.ai.setStateObj(state.split("|")[0], state.split("|")[1], this.getDefaultActionValues(Number(state.split("|")[1]) < 3 ? "e" : ""));

        }

        let oldQValue = await database.ai.getQValue(state.split("|")[0], state.split("|")[1], action) || 0.0;

        return oldQValue + this.alpha * (reward - oldQValue);

    }

    // stateActionPairs is an array of state-action pairs, representing the actions taken in the states before the reward was received. stateActionPairs[0] is the most recent state-action pair, where the reward was received, stateActionPairs[1] is the second most recent state-action pair, etc
    async updateQValues (stateActionPairs, reward) {
        
        const promises = [];

        for (let i = 0; i < stateActionPairs.length; i++) {

            promises.push(this.calculateQValues(this.lambda**i*reward, stateActionPairs[i][0], stateActionPairs[i][1])
                .then(newQValue => { return database.ai.setQValue(stateActionPairs[i][0].split("|")[0], stateActionPairs[i][0].split("|")[1], stateActionPairs[i][1], newQValue) }));

        }

        console.log(promises)
        console.log(await Promise.all(promises))

        await Promise.all(await Promise.all(promises))

    }

    async selectAction (state) {

        if (!(await database.ai.getStateObj(state.split("|")[0], state.split("|")[1]))) {

            await database.ai.setStateObj(state.split("|")[0], state.split("|")[1], this.getDefaultActionValues(Number(state.split("|")[1]) < 3 ? "e" : ""));

        }

        if (Math.random() < this.epsilon) {

            return this.possibleActions[Math.floor(Math.random()*this.possibleActions.length)];

        }

        const actionRewards = await database.ai.getStateObj(state.split("|")[0], state.split("|")[1]);

        let maxReward = -Infinity;
        let maxRewardAction = null;

        for (let action of this.possibleActions) {

            if ((actionRewards[action] || 0.0) > maxReward) {

                maxReward = actionRewards[action] || 0.0;
                maxRewardAction = action;

            }

        }

        return maxRewardAction;

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

const updateAI = async (userID, topicID, quizScore, averageSessionTime) => {

    const actions = (await database.topics.getLessonChunkContentFormats(userID, topicID)).reverse();
    const userIDHash = utils.hash(userID, "base64");

    const stateActionPairs = [];

    for (let i = 0; i < actions.length; i++) {

        stateActionPairs.push([userIDHash + "|" + i.toString(), actions[i] || new utils.ErrorHandler("0x00003F").throwError()])

    }

    const updateQValuesProm = qLearning.updateQValues(stateActionPairs, quizScore);

    let setUserNumChunksProm;

    if (averageSessionTime > 3600000) { // 1 hour per lesson

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