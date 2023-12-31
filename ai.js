import crypto from "crypto"
import utils from "./utils.js"
import database from "./database.js";
import { availableParallelism } from "os";

const courseData = await database.config.getConfigData("course_data");
const topicData = await database.config.getConfigData("topic_data");

class QLearning {

    constructor (possibleActions) {

        this.alpha = 0.3;
        this.epsilon = 0.05;
        this.lambda = 0.9;
        this.possibleActions = possibleActions;
        this.defaultActionValues = possibleActions.reduce((obj, key) => { obj[key] = Math.random()/20; return obj; }, {});

    }

    async calculateQValues (reward, state, action) {

        if (!(await database.ai.redis.getJSON(state))) {

            await database.ai.redis.setJSON(state, this.defaultActionValues);

        }

        let oldQValue = await database.ai.redis.getJSON(state, "." + action) || 0.0;

        return oldQValue + this.alpha * (reward - oldQValue);

    }

    // stateActionPairs is an array of state-action pairs, representing the actions taken in the states before the reward was received. stateActionPairs[0] is the most recent state-action pair, where the reward was received, stateActionPairs[1] is the second most recent state-action pair, etc
    async updateQValues (stateActionPairs, reward) {
        
        for (let i = 0; i < stateActionPairs.length; i++) {

            await database.ai.redis.setJSON(stateActionPairs[i][0], await this.calculateQValues(this.lambda**i*reward, stateActionPairs[i][0], stateActionPairs[i][1]), "." + stateActionPairs[i][1]);

        }

    }

    async selectAction (state) {

        if (!(await database.ai.redis.getJSON(state))) {

            await database.ai.redis.setJSON(state, this.defaultActionValues);

        }

        if (Math.random() < this.epsilon) {

            return this.possibleActions[Math.floor(Math.random()*this.possibleActions.length)];

        }

        const actionRewards = await database.ai.redis.getJSON(state);

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

    const userIDHash = utils.hash(userID, "base64");
    const lessonIndexes = await database.courses.getLessonIndexes(userID, courseID);

    const completedTopics = await database.courses.getCompletedTopics(userID);

    let topicID;

    let i = 0;

    do {

        topicID = courseData[courseID].topics[i];

        i++;

    } while(completedTopics.includes(topicID));
    
    const state = userIDHash + lessonIndexes[1].toString();

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

            filename = "exercise.html"

            break;
     
        default:

            new utils.ErrorHandler("0x000000", "Invalid action returned from q-learning").throwError();

            break;

    }

    const contentRoute = `/${topicID}/${lessonIndexes[1].toString()}/${filename}`

    const signature = crypto.createHmac(process.env.HASHING_ALGORITHM, process.env.HMAC_SECRET).update(contentRoute).digest("base64url")

    await database.courses.setChunkContentFormat(userID, courseID, lessonIndexes[0], lessonIndexes[1], contentFormat)

    return contentRoute + "|" + signature;

};

const updateAI = async (userID, courseID, lessonNumber, quizScore, averageSessionTime) => {

    const actions = (await database.courses.getLessonChunkContentFormats(userID, courseID, lessonNumber)).reverse();

    const userIDHash = utils.hash(userID, "base64");

    const stateActionPairs = [];

    for (let i = 0; i < actions.length; i++) {

        stateActionPairs.push([userIDHash + i.toString(), actions[i] || new utils.ErrorHandler().throwError("0x000000", "Action is undefined.")])

    }

    await qLearning.updateQValues(stateActionPairs, quizScore);

    if (averageSessionTime < 600000) {

        if (quizScore > 0.85) {

            const currentUserNumChunks = await database.ai.getUserNumChunks(userID);

            await database.ai.setUserNumChunks(userID, currentUserNumChunks - 1);

        }

    }

    else {

        if (quizScore < 0.75) {

            const currentUserNumChunks = await database.ai.getUserNumChunks(userID);

            await database.ai.setUserNumChunks(userID, currentUserNumChunks + 1);
    
        }

    }

}

export default {

    getContentID,
    updateAI

}