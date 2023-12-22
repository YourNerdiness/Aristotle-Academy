import utils from "./utils.js"
import database from "./database.js";

// uses relational cluster IDs, such that cluster IDs numerically closer are more similar to one another than they are both to clusters with with cluster IDs numerically further
class KMeans {

    calculateDistance(vector1, vector2) {

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

    calculateAverageVector(vectors) {

        if (vectors.length === 0) {

            throw new Error("No vectors given");

        }

        const dimensions = vectors[0].length;

        for (const vector of vectors) {

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

    calcualateKMeansWithLinearIDs(data = [], dimension, k, iterations = 16, nRuns = 10) {

        for (let i = 0; i < data.length; i++) {

            if (data[0].length != dimension) {

                new ErrorHandler("0x000003").throwError();

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

                        const distance = this.calculateDistance(data[j], clusterCenters[l])

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

                    clusterCenters[j] = this.calculateAverageVector(clustering[j]);

                }

            }

            const clusterCentersAverageDistance = clustering.reduce((acc, cluster, index) => {

                acc += cluster.reduce((clusterAcc, dataPoint) => {

                    clusterAcc += this.calculateDistance(dataPoint, clusterCenters[index]);

                    return clusterAcc;

                }, 0) / cluster.length;

                return acc;

            }, 0) / clustering.length;

            if (clusterCentersAverageDistance < bestClusterCentersAverageDistance) {

                bestClusterCenters = clusterCenters;
                bestClustering = clustering;
                bestClusterCentersAverageDistance = clusterCentersAverageDistance;

            }

        }

        const output = [];

        for (let i = 0; i < bestClusterCenters.length; i++) {

            output.push({ clusterCenter: bestClusterCenters[i], clusterData: bestClustering[i] })

        }

        let mostNegativeClusterID = 0;

        // TODO : convert to for-loop to make handling division by zero errors easier

        const baseClusterCenterForSorting = bestClusterCenters.reduce((mostNegativeClusterCenter, clusterCenter, i) => {

            if (clusterCenter.reduce((acc, currentValue) => acc + currentValue, 0)/bestClustering[i].length < mostNegativeClusterCenter.reduce((acc, currentValue) => acc + currentValue, 0)/bestClustering[mostNegativeClusterID].length ) {

                mostNegativeClusterID = i;

                return clusterCenter;

            }

            return mostNegativeClusterCenter;

        }, bestClusterCenters[0]);

        output.sort((a, b) => {

            return this.calculateDistance(baseClusterCenterForSorting, a.clusterCenter) - this.calculateDistance(baseClusterCenterForSorting, b.clusterCenter);

        });

        return output;

    };

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

        if (!(await database.ai.redis.getJSON(state))) {

            await database.ai.redis.setJSON(state, this.defaultActionValues);

        }

        let oldQValue = await database.ai.redis.getJSON(state, "." + action) || 0.0;

        return oldQValue + this.alpha * (reward - oldQValue);

    }

    // stateActionPairs is an array of state-action pairs, representing the actions taken in the states before the reward was received. stateActionPairs[0] is the most recent state-action pair, where the reward was received, stateActionPairs[1] is the second most recent state-action pair, etc
    async updateQValues (reward, stateActionPairs) {
        
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

const getContentID = async (courseName, userID) => {

    // TODO



    return "123456789abcdefg"

};

export default {

    getContentID

}