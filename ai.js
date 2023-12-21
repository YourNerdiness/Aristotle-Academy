import utils from "./utils.js"
import dotenv from "dotenv"
import redis from "redis"

dotenv.config();

const client = redis.createClient({

    password: process.env.REDIS_PASSWORD,
    socket: {

        host: process.env.REDIS_HOSTNAME,
        port: 11951

    }

});

client.on("error", err => new utils.ErrorHandler("0x000000", err).throwError() );

await client.connect();

const redisFuncs = {

    set : async (key, val) => await client.set(key, val),
    setJSON : async (key, val, path="$") => await client.json.set(key, path, val),
    get : async (key) => await client.get(key),
    getJSON : async (key, path="$") => await client.json.get(key, { path }),
    del : async (key) => await client.del(key),
    delJSON : async (key, path="$") => await client.json.del(key, path)

};

function calculateDistance(vector1, vector2) {

    if (vector1.length !== vector2.length) {

        throw new Error("Vectors must have the same dimensionality");
    
    }

    let squaredSum = 0;

    for (let i = 0; i < vector1.length; i++) {

        const diff = vector1[i] - vector2[i];

        squaredSum += diff * diff;

    }

    const distance = Math.sqrt(squaredSum);

    return distance;

}

function calculateAverageVector(vectors) {

    if (vectors.length === 0) {

        throw new Error("No vectors given");

    }

    const dimensions = vectors[0].length;

    for (const vector of vectors) {// Return null for an empty array
        if (vector.length !== dimensions) {

            throw new Error("All vectors must have the same dimensions");

        }

    }

    const sumVector = new Array(dimensions).fill(0);

    for (const vector of vectors) {

        for (let i = 0; i < dimensions; i++) {

            sumVector[i] += vector[i];
            
        }

    }

    const averageVector = sumVector.map(sum => sum / vectors.length);

    return averageVector;
}

const calcualateKMeansWithLinearIDs = (data=[], dimension, k, iterations=16, nRuns=10) => {

    for (let i = 0; i < data.length; i++) {

        if (data[0].length != dimension) {

            utils.throwError("0x000003")

        }

    }

    let bestClusterCenters = [];
    let bestClustering = [];
    let bestClusterCentersAverageDistance = Number.POSITIVE_INFINITY;

    for (let run = 0; run < nRuns; run++) {

        let clusterCenters = [];
        let clustering = [];

        while (clusterCenters.length < k) {

            clusterCenters.push(data[Math.floor(Math.random() * data.length)])

        }

        for (let i = 0; i < iterations; i++) {

            for (let j = 0; j < k; j++) {

                clustering[j] = [];
    
            }

            for (let j = 0; j < data.length; j++) {

                let currentDistance = Number.POSITIVE_INFINITY;
                let clusterID = 0;

                for (let l = 0; l < clusterCenters.length; l++) {

                    const distance = calculateDistance(data[j], clusterCenters[l])

                    if (distance < currentDistance) {

                        currentDistance = distance;
                        clusterID = l;

                    }

                }

                clustering[clusterID].push(data[j])

            }

            for (let j = 0; j < clustering.length; j++) {

                if (clustering[j].length == 0) {

                    continue;
                    
                }   

                clusterCenters[j] = calculateAverageVector(clustering[j]);

            }

        }

        const clusterCentersAverageDistance = clustering.reduce((acc, cluster, index) => {

            acc += cluster.reduce((clusterAcc, dataPoint) => {

                clusterAcc += calculateDistance(dataPoint, clusterCenters[index]);

                return clusterAcc;

            }, 0)/cluster.length;

            return acc;

        }, 0)/clustering.length;

        if (clusterCentersAverageDistance < bestClusterCentersAverageDistance) {

            bestClusterCenters = clusterCenters;
            bestClustering = clustering;
            bestClusterCentersAverageDistance = clusterCentersAverageDistance;

        }

    }

    const output = [];

    for (let i = 0; i < bestClusterCenters.length; i++) {

        output.push({ clusterCenter : bestClusterCenters[i], clusterData : bestClustering[i] })

    }

    const baseClusterCenterForSorting = bestClusterCenters.reduce((mostNegativeClusterCenter, clusterCenter) => {

        if (clusterCenter.reduce((acc, currentValue) => acc + currentValue, 0) < mostNegativeClusterCenter.reduce((acc, currentValue) => acc + currentValue, 0)) {

            return clusterCenter;

        }

        return mostNegativeClusterCenter;

    }, bestClusterCenters[0]);

    output.sort((a, b) => {

        return calculateDistance(baseClusterCenterForSorting, a.clusterCenter) - calculateDistance(baseClusterCenterForSorting, b.clusterCenter);

    });

    return output;

};

class QLearning {

    constructor (possibleActions) {

        this.alpha = 0.3;
        this.epsilon = 0.05;
        this.lambda = 0.9;
        this.possibleActions = possibleActions;
        this.defaultActionValues = possibleActions.reduce((obj, key) => { obj[key] = 0.0; return obj; }, {});

    }

    async calculateQValues (reward, state, action) {

        if (!(await redisFuncs.getJSON(state))) {

            await redisFuncs.setJSON(state, this.defaultActionValues);

        }

        let oldQValue = await redisFuncs.getJSON(state, "." + action) || 0.0;

        return oldQValue + this.alpha * (reward - oldQValue);

    }

    // stateActionPairs is an array of state-action pairs, representing the actions taken in the states before the reward was received. stateActionPairs[0] is the most recent state-action pair, where the reward was received, stateActionPairs[1] is the second most recent state-action pair, etc
    async updateQValues (reward, stateActionPairs) {
        
        for (let i = 0; i < stateActionPairs.length; i++) {

            await redisFuncs.setJSON(stateActionPairs[i][0], await this.calculateQValues(this.lambda**i*reward, stateActionPairs[i][0], stateActionPairs[i][1]), "." + stateActionPairs[i][1]);

        }

    }

    async selectAction (state) {

        if (!(await redisFuncs.getJSON(state))) {

            await redisFuncs.setJSON(state, this.defaultActionValues);

        }

        if (Math.random() < this.epsilon) {

            return this.possibleActions[Math.floor(Math.random()*this.possibleActions.length)];

        }

        const actionRewards = await redisFuncs.getJSON(state);

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

const getContentID = async (courseName, userID) => {

    // TODO

    return "123456789abcdefg"

};

export default {

    getContentID

}