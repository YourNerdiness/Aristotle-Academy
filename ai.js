import utils from "./utils.js"
import util from "util"

util.inspect.defaultOptions.depth = null;

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

export default {

    calcualateKMeansWithLinearIDs

}