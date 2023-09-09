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

const result = calcualateKMeansWithLinearIDs([
    [9.232, 3.721],
    [9.872, 2.155],
    [9.439, 4.611],
    [9.107, 4.957],
    [8.512, 6.297],
    [8.762, 6.147],
    [9.385, 4.791],
    [9.623, 2.987],
    [9.962, 1.634],
    [8.965, 5.829],
    [18.674, 3.246],
    [19.887, 0.815],
    [20.347, 0.455],
    [20.010, 1.784],
    [18.222, 5.784],
    [19.345, 3.568],
    [20.067, 0.190],
    [19.115, 4.542],
    [20.136, 1.187],
    [18.977, 2.708],
    [30.328, 0.925],
    [29.654, 4.546],
    [29.239, 5.739],
    [30.715, 0.051],
    [28.592, 7.839],
    [30.214, 1.684],
    [29.470, 3.721],
    [30.983, 2.125],
    [28.016, 8.152],
    [29.882, 4.309],
    [41.312, 1.432],
    [39.764, 6.381],
    [40.238, 4.363],
    [40.786, 1.005],
    [41.854, 1.617],
    [39.923, 4.284],
    [39.348, 5.931],
    [40.479, 2.858],
    [42.369, 1.078],
    [41.027, 3.710],
    [48.959, 11.937],
    [48.043, 13.348],
    [51.186, 3.214],
    [49.985, 5.943],
    [49.562, 7.975],
    [51.243, 2.872],
    [50.270, 6.554],
    [50.731, 5.146],
    [48.314, 11.765],
    [48.725, 10.250]
], 2, 5, 64, 1000000);

console.log(result);

export default {

    calcualateKMeansWithLinearIDs

}