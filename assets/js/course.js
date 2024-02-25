let time;
let quizQuestionData;

const utils = {

    shuffleArray : (arr=[]) => {

        for (let i = arr.length - 1; i >= 0; i--) {

            const j = Math.floor(Math.random()*(i + 1));

            const temp = arr[j];

            arr[j] = arr[i];
            arr[i] = temp;

        }

        return arr;

    }

}

const submitExercise = async () => {

    const lessonNumber = new URLSearchParams(window.location.search).get("lessonNumber");
    const lessonChunk = new URLSearchParams(window.location.search).get("lessonChunk");
    const courseID = new URLSearchParams(window.location.search).get("courseID");

    const data = { quizScore, lessonNumber, lessonChunk, courseID };

    const req = {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(data)

    };

    document.getElementById("loadingDialog").showModal();

    const res = await fetch("/completeLesson", req);

    document.getElementById("loadingDialog").close();

    if (res.ok) {

        const { newURL } = await res.json();

        window.location.href = newURL;

    }

    else {

        const error = await res.json();
        
        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }

};
const submitQuiz = async () => {

    const questions = quizQuestionData?.questions;

    if (!questions) {

        $("#error").text("Cannot find question data.");

    }

    let points = 0;

    for (let i = 0; i < questions.length; i++) {

        const question = questions[i];

        switch (question.type) {

            case "multiple-choice":

                const mcFieldset = document.getElementById(`mcFieldset${i}`);

                if (!mcFieldset) {

                    $("#error").text(`Cannot find question ${i}.`);

                }

                const givenAnswer = document.querySelector(`#mcFieldset${i} input[type="radio"]:checked`);

                if (givenAnswer.value == question.answer) {

                    points++;

                }

                break;

        }

    }

    const quizScore = points / questions.length;

    const lessonNumber = new URLSearchParams(window.location.search).get("lessonNumber");
    const lessonChunk = new URLSearchParams(window.location.search).get("lessonChunk");
    const courseID = new URLSearchParams(window.location.search).get("courseID");

    const data = { quizScore, lessonNumber, lessonChunk, courseID };

    const req = {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(data)

    };

    document.getElementById("loadingDialog").showModal();

    const res = await fetch("/completeLesson", req);

    document.getElementById("loadingDialog").close();

    if (res.ok) {

        const { newURL } = await res.json();

        window.location.href = newURL;

    }

    else {

        const error = await res.json();
        
        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }


};

const sendSessionTimeToServer = (sessionTime=(Date.now()-Number(localStorage.getItem("sessionStartTime")))) => {

    fetch('/logSessionTime', {

        method: 'POST',

        body: JSON.stringify({ sessionTime, courseID : new URLSearchParams(window.location.search).get("courseID") }),

        headers: {

            'Content-Type': 'application/json'

        }

    });

}

const resetTimer = () => {

    if ((Number(localStorage.getItem("sessionStartTime")) || Number.NEGATIVE_INFINITY) + 300000 <= Date.now()) {

        localStorage.setItem("sessionStartTime", Date.now());

    }

    clearTimeout(time);
    time = setTimeout(sendSessionTimeToServer, 300000);

}

document.onmousemove = resetTimer;
document.onmousedown = resetTimer
document.onkeydown = resetTimer;
window.onbeforeunload = () => localStorage.setItem("lastSessionEndTime", Date.now());

window.onload = async () => {

    document.getElementById("loadingDialog").showModal();

    const contentID = new URLSearchParams(window.location.search).get("contentID");

    if (!contentID) {

        $("#error").text("ContentID is missing.");

        return;

    }

    const contentIDParts = contentID.split("|");

    const data = { data: contentIDParts[0], signature: contentIDParts[1] };

    const req = {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(data)

    };

    const res = await fetch("/verifyHMACSignature", req);

    if (!res.ok) {

        const error = await res.json();

        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }

    if (!(await res.json()).verified) {

        $("#error").text("Content route cannot be verified, possible XSS attack.");

        return;

    }

    switch (contentIDParts[0].split("/")[3][0]) {

        case "v":

            $("#video > source").first().attr("src", "https://coursecontent.aristotle.academy" + contentIDParts[0]);

            $("#video").on("ended", () => {

                $("#continue").prop("disabled", false);

            });

            $("#video").show();
            $("#paragraph").hide();
            $("#exercise").hide();
            $("#quiz").hide();

            $("#continue").on("click", submitExercise);

            break;

        case "t":

            $("#continue").prop("disabled", false);

            $("#paragraph").html(marked.parse(await (await fetch("https://coursecontent.aristotle.academy" + contentIDParts[0])).text()));

            $("#video").hide();
            $("#paragraph").show();
            $("#exercise").hide();
            $("#quiz").hide();

            $("#continue").on("click", submitExercise);

            break;

        case "e":

            const exerciseData = await (await fetch("https://coursecontent.aristotle.academy" + contentIDParts[0])).json();

            const exerciseDiv = document.getElementById("exercise");

            switch (exerciseData.type) {

                case "match-tight":

                    localStorage.removeItem("match_tight_last_column_one_clicked");
                    localStorage.removeItem("match_tight_last_column_two_clicked");
                    localStorage.removeItem("match_tight_num_matched");

                    const pairs = exerciseData.data.pairs;
                    const description = exerciseData.data.description;

                    const p = document.createElement("p");

                    p.textContent = description;
                    p.classList = "center"

                    exerciseDiv.appendChild(p);

                    const columnOne = pairs.map(x => x[0]);
                    const columnTwo = pairs.map(x => x[1]);

                    utils.shuffleArray(columnOne);
                    utils.shuffleArray(columnTwo);

                    const table = document.createElement("table");

                    exerciseDiv.appendChild(table);

                    for (let i = 0; pairs.length; i++) {

                        const tableRow = document.createElement("tr");

                        const columnOneElem = document.createElement("td");
                        const columnTwoElem = document.createElement("td");

                        const columnOneBtn = document.createElement("button");
                        const columnTwoBtn = document.createElement("button");

                        columnOneBtn.textContent = columnOne[i];
                        columnTwoBtn.textContent = columnTwo[i];

                        columnOneBtn.addEventListener("click", () => { 

                            if (columnTwo[i] == localStorage.getItem("match_tight_last_column_two_clicked")) { 

                                columnOneBtn.disabled = true; 
                                columnTwoBtn.disabled = true;

                                columnOneBtn.style.backgroundColor = "";
                                columnTwoBtn.style.backgroundColor = "";

                                localStorage.removeItem("match_tight_last_column_one_clicked");
                                localStorage.removeItem("match_tight_last_column_two_clicked");

                                localStorage.setItem("match_tight_num_matched", (localStorage.getItem("match_tight_num_matched") || 0) + 1);

                                if (localStorage.getItem("match_tight_num_matched") >= pairs.length) {

                                    $("#continue").prop("disabled", false);

                                }
                            
                            }

                            else {

                                if (localStorage.getItem("match_tight_last_column_two_clicked")) {

                                    columnOneBtn.disabled = false; 
                                    columnTwoBtn.disabled = false;

                                    columnOneBtn.style.backgroundColor = "";
                                    columnTwoBtn.style.backgroundColor = "";

                                    localStorage.removeItem("match_tight_last_column_one_clicked");
                                    localStorage.removeItem("match_tight_last_column_two_clicked");

                                }

                                else {

                                    columnOneBtn.disabled = true;
                                    columnOneBtn.style.backgroundColor = "lightgray";

                                    localStorage.setItem("match_tight_last_column_one_clicked", columnOne[i]);

                                }

                            }

                        });

                        columnTwoBtn.addEventListener("click", () => { 

                            if (columnTwo[i] == localStorage.getItem("match_tight_last_column_one_clicked")) { 

                                columnOneBtn.disabled = true; 
                                columnTwoBtn.disabled = true;

                                columnOneBtn.style.backgroundColor = "";
                                columnTwoBtn.style.backgroundColor = "";

                                localStorage.removeItem("match_tight_last_column_one_clicked");
                                localStorage.removeItem("match_tight_last_column_two_clicked");

                                localStorage.setItem("match_tight_num_matched", (localStorage.getItem("match_tight_num_matched") || 0) + 1);

                                if (Number(localStorage.getItem("match_tight_num_matched")) >= pairs.length) {

                                    $("#continue").prop("disabled", false);

                                }
                            
                            }

                            else {

                                if (localStorage.getItem("match_tight_last_column_one_clicked")) {

                                    columnOneBtn.disabled = false; 
                                    columnTwoBtn.disabled = false;

                                    columnOneBtn.style.backgroundColor = "";
                                    columnTwoBtn.style.backgroundColor = "";

                                    localStorage.removeItem("match_tight_last_column_one_clicked");
                                    localStorage.removeItem("match_tight_last_column_two_clicked");

                                }

                                else {

                                    columnTwoBtn.disabled = true;
                                    columnTwoBtn.style.backgroundColor = "lightgray";

                                    localStorage.setItem("match_tight_last_column_two_clicked", columnOne[i]);

                                }

                            }

                        });

                        tableRow.appendChild(columnOneElem);
                        tableRow.appendChild(columnTwoElem);

                        table.appendChild(tableRow);

                    }

                    break;

                case "multiple-choice":

                    localStorage.removeItem("multiple_choice_correct_answer_index");

                    const select = document.createElement("select");

                    exerciseDiv.appendChild(select);

                    const possibleAnswers = exerciseData.data.possibleAnswers;
                    const correctAnswerIndex = exerciseData.data.possibleAnswers.toString();

                    localStorage.setItem("multiple_choice_correct_answer_index", correctAnswerIndex);

                    for (let i = 0; i < possibleAnswers.length; i++) {

                        const option = document.createElement("option");

                        select.appendChild(option);

                        option.value = i.toString();
                        option.textContent = possibleAnswers[i];

                    }

                    select.addEventListener("change", () => {

                        if (this.value == localStorage.getItem("multiple_choice_correct_answer_index")) {
                            
                            $("#continue").prop("disabled", false);

                        }

                    });

                    break;
                    
                default:

                    $("#error").text("Invalid exercise type.");

                    break;

            }

            $("#video").hide();
            $("#paragraph").hide();
            $("#exercise").show();
            $("#quiz").hide();

            $("#continue").on("click", submitExercise);

            break;

        case "q":

            const quizData = await (await fetch("https://coursecontent.aristotle.academy" + contentIDParts[0])).json();

            $("#continue").prop("disabled", false);

            quizQuestionData = quizData;

            const questions = quizData.questions;

            const div = document.getElementById("quiz");

            const questionTable = document.createElement("table")

            questionTable.id = "questionTable"

            div.appendChild(questionTable);

            for (let i = 0; i < questions.length; i++) {

                const question = questions[i];

                const tr = document.createElement("tr");

                tr.id = `questionRow${i}`;

                switch (question.type) {

                    case "multiple-choice":

                        const mcFieldset = document.createElement("fieldset");

                        mcFieldset.id = `mcFieldset${i}`

                        const mcLegend = document.createElement("legend");

                        mcFieldset.appendChild(mcLegend);

                        const possibleAnswers = question.possibleAnswers;

                        for (let j = 0; j < possibleAnswers.length; j++) {

                            const answerInputElem = document.createElement("input");
                            const answerLabelElem = document.createElement("label");

                            answerInputElem.type = "radio";
                            answerInputElem.id = `mcAnswer${i}-${j}`;
                            answerInputElem.name = `mcAnswer${i}`;
                            answerInputElem.value = possibleAnswers[i];

                            if (j == 0) {

                                answerInputElem.checked = true;

                            }

                            answerLabelElem.for = `mcAnswer${i}`;
                            answerLabelElem.textContent = possibleAnswers[i];

                            mcFieldset.appendChild(answerInputElem);
                            mcFieldset.appendChild(answerLabelElem);

                        }

                        tr.appendChild(mcFieldset);

                        break;

                }

                questionTable.appendChild(tr);

            }

            $("#video").hide();
            $("#paragraph").hide();
            $("#exercise").hide();
            $("#quiz").show();

            $("#continue").on("click", submitQuiz);

            break;

        default:

            $("#error").text("Invalid content format.");

            break;

    }

    document.getElementById("loadingDialog").close();

    if (localStorage.getItem("lastSessionEndTime")) {

        if ((Number(localStorage.getItem("sessionStartTime")) || Number.POSITIVE_INFINITY) + 300000 <= Date.now()) {

            sendSessionTimeToServer(Number(localStorage.getItem("lastSessionEndTime")) - Number(localStorage.getItem("sessionStartTime")));
            
        }

        localStorage.removeItem("lastSessionEndTime")

    }

    resetTimer();

}