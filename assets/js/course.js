let time;
let quizQuestionData;

let quizScore;

const utils = {

    shuffleArray : (arr=[]) => {

        for (let i = arr.length - 1; i >= 0; i--) {

            const j = Math.floor(Math.random()*(i + 1));

            const temp = arr[j];

            arr[j] = arr[i];
            arr[i] = temp;

        }

    }

}

const backLessonChunk = async () => {

    const topicID = new URLSearchParams(window.location.search).get("topicID");
    const lessonChunk = Number(new URLSearchParams(window.location.search).get("lessonChunk"));
    const courseID = new URLSearchParams(window.location.search).get("courseID");

    const data = { topicID, lessonChunk, courseID };

    const req = {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(data)

    };

    document.getElementById("loadingDialog").showModal();

    const res = await fetch("/backLessonChunk", req);

    if (res.ok) {

        const { newURL } = await res.json();

        window.location.href = newURL;

    }

    else {

        document.getElementById("loadingDialog").close();

        const error = await res.json();
        
        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }

};

const submitLessonChunk = async () => {

    const topicID = new URLSearchParams(window.location.search).get("topicID");
    const lessonChunk = Number(new URLSearchParams(window.location.search).get("lessonChunk"));
    const courseID = new URLSearchParams(window.location.search).get("courseID");

    const data = { topicID, lessonChunk, courseID };

    const req = {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(data)

    };

    document.getElementById("loadingDialog").showModal();

    const res = await fetch("/completeLessonChunk", req);

    if (res.ok) {

        const { newURL } = await res.json();

        window.location.href = newURL;

    }

    else {

        document.getElementById("loadingDialog").close();

        const error = await res.json();
        
        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }

};

const showQuizScore = () => {

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

    quizScore = points / questions.length;
    quizPerc = quizScore * 100
    quizPercRounded = Math.round(quizPerc);

    $("#quizScore").text(`${quizPercRounded}%`)

    $("#quizScoreDialog")[0].showModal();

    $(".quizInput").forEach((elem) => { elem.disabled = true });

}

const submitQuiz = async () => {

    sendSessionTimeToServer()

    const topicID = new URLSearchParams(window.location.search).get("topicID");
    const lessonChunk = Number(new URLSearchParams(window.location.search).get("lessonChunk"));
    const courseID = new URLSearchParams(window.location.search).get("courseID");

    const data = { quizScore, lessonChunk, courseID, topicID };

    const req = {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(data)

    };

    document.getElementById("loadingDialog").showModal();

    const res = await fetch("/completeLesson", req);

    if (res.ok) {

        const { newURL } = await res.json();

        window.location.href = newURL;

    }

    else {

        document.getElementById("loadingDialog").close();

        const error = await res.json();
        
        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }


};

const sendSessionTimeToServer = (sessionTime=(Date.now()-Number(localStorage.getItem("sessionStartTime")))) => {

    const contentID = new URLSearchParams(window.location.search).get("contentID");

    fetch('/logSessionTime', {

        method: 'POST',

        body: JSON.stringify({ sessionTime, courseID : new URLSearchParams(window.location.search).get("courseID"), topicID : new URLSearchParams(window.location.search).get("topicID") }),

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

const showCorrectDialog = () => {

    document.getElementById("correctDialog").show();

    setTimeout(() => { document.getElementById("correctDialog").close(); }, 1000)

}

const showIncorrectDialog = () => {

    document.getElementById("incorrectDialog").show();

    setTimeout(() => { document.getElementById("incorrectDialog").close(); }, 1000)

}

document.onmousemove = resetTimer;
document.onmousedown = resetTimer
document.onkeydown = resetTimer;
$(window).on("unload", localStorage.setItem("lastSessionEndTime", Date.now()));

$(document).ready(async () => {


    document.getElementById("loadingDialog").showModal();

    const contentID = new URLSearchParams(window.location.search).get("contentID");
    const courseID = new URLSearchParams(window.location.search).get("courseID");
    const lessonChunk = Number(new URLSearchParams(window.location.search).get("lessonChunk"));
    const lessonMaxChunk = Number(new URLSearchParams(window.location.search).get("lessonMaxChunk"));

    const lessonCompletionPerc = ((lessonChunk + 1)/(lessonMaxChunk + 1))*100

    $("#lessonProgress").css("background-image", `linear-gradient(to right, yellow 0%, yellow ${lessonCompletionPerc}%, transparent ${lessonCompletionPerc}%)`)

    if (lessonChunk > 0) {

        $("#back").on("click", backLessonChunk).prop("disabled", false);

    }

    const contentIDParts = contentID.split("|");

    // index for contentIDParts[0].split("/") is either 2 or 3 because there is a / prefix

    switch ((contentIDParts[0].split("/")[3] || contentIDParts[0].split("/")[2])[0]) {

        case "v":

            $("#video").show();
            $("#paragraph").hide();
            $("#exercise").hide();
            $("#quiz").hide();

            $("#continue").on("click", submitLessonChunk);

            $("#video > source").first().attr("src", "https://coursecontent.aristotle.academy" + contentIDParts[0]);

            $("#video")[0].load();

            $("#video").on("ended", () => {

                $("#continue").prop("disabled", false);

            });

            break;

        case "t":

            $("#video").hide();
            $("#paragraph").show();
            $("#exercise").hide();
            $("#quiz").hide();

            $("#continue").on("click", submitLessonChunk);

            $("#continue").prop("disabled", false);

            const textCourseContentData = {

                contentID,
                courseID

            };

            const textCourseContentReq = {

                method: "POST",
        
                headers: {
        
                    "Content-Type": "application/json"
        
                },
        
                body: JSON.stringify(textCourseContentData)
        
            };;

            const textCourseContentRes = await (await fetch("/getLessonChunkContent", textCourseContentReq)).json();

            $("#paragraph").html(marked.parse(textCourseContentRes.data.replace(/>/gm, "")));

            break;

        case "e":

            $("#video").hide();
            $("#paragraph").hide();
            $("#exercise").show();
            $("#quiz").hide();

            $("#continue").on("click", submitLessonChunk);

            const exerciseCourseContentData = {

                contentID,
                courseID

            };

            const exerciseCourseContentReq = {

                method: "POST",
        
                headers: {
        
                    "Content-Type": "application/json"
        
                },
        
                body: JSON.stringify(exerciseCourseContentData)
        
            };;

            const exerciseCourseContentRes = await (await fetch("/getLessonChunkContent", exerciseCourseContentReq)).json();

            const exerciseData = JSON.parse(exerciseCourseContentRes.data);

            const exerciseDiv = document.getElementById("exercise");

            switch (exerciseData.type) {

                case "match-tight":

                    localStorage.removeItem("match_tight_last_column_one_clicked");
                    localStorage.removeItem("match_tight_last_column_two_clicked");
                    localStorage.removeItem("match_tight_num_matched");

                    const description = exerciseData.data.description;
                    const pairs = exerciseData.data.pairs;

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

                    for (let i = 0; i < pairs.length; i++) {

                        const tableRow = document.createElement("tr");

                        const columnOneElem = document.createElement("td");
                        const columnTwoElem = document.createElement("td");

                        const columnOneBtn = document.createElement("button");
                        const columnTwoBtn = document.createElement("button");

                        columnOneBtn.textContent = columnOne[i];
                        columnTwoBtn.textContent = columnTwo[i];

                        columnOneBtn.addEventListener("click", () => {
                            
                            const correctAnswerText = pairs[pairs.findIndex((elem) => elem[0] == columnOne[i])][1];
                            const correctAnswerBtn = $("button").filter((_, elem) => $(elem).text().trim() == correctAnswerText )[0]

                            if (correctAnswerText == localStorage.getItem("match_tight_last_column_two_clicked")) { 

                                showCorrectDialog();

                                columnOneBtn.disabled = true; 
                                correctAnswerBtn.disabled = true;

                                columnOneBtn.style.backgroundColor = "";
                                correctAnswerBtn.style.backgroundColor = "";

                                localStorage.removeItem("match_tight_last_column_one_clicked");
                                localStorage.removeItem("match_tight_last_column_two_clicked");

                                localStorage.setItem("match_tight_num_matched", (Number(localStorage.getItem("match_tight_num_matched") || 0)) + 1);

                                if (Number(localStorage.getItem("match_tight_num_matched")) >= pairs.length) {

                                    $("#continue").prop("disabled", false);

                                }
                            
                            }

                            else {

                                if (localStorage.getItem("match_tight_last_column_two_clicked")) {

                                    showIncorrectDialog();

                                    columnOneBtn.disabled = false; 
                                    $("button").filter((_, elem) => $(elem).text().trim() == localStorage.getItem("match_tight_last_column_two_clicked"))[0].disabled = false;

                                    columnOneBtn.style.backgroundColor = "";
                                    $("button").filter((_, elem) => $(elem).text().trim() == localStorage.getItem("match_tight_last_column_two_clicked"))[0].style.backgroundColor = "";

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

                            const correctAnswerText = pairs[pairs.findIndex((elem) => elem[1] == columnTwo[i])][0];
                            const correctAnswerBtn = $("button").filter((_, elem) => $(elem).text().trim() == correctAnswerText )[0]

                            if (correctAnswerText == localStorage.getItem("match_tight_last_column_one_clicked")) { 

                                showCorrectDialog();

                                correctAnswerBtn.disabled = true; 
                                columnTwoBtn.disabled = true;

                                correctAnswerBtn.style.backgroundColor = "";
                                columnTwoBtn.style.backgroundColor = "";

                                localStorage.removeItem("match_tight_last_column_one_clicked");
                                localStorage.removeItem("match_tight_last_column_two_clicked");

                                localStorage.setItem("match_tight_num_matched", (Number(localStorage.getItem("match_tight_num_matched")) || 0) + 1);

                                if (Number(localStorage.getItem("match_tight_num_matched")) >= pairs.length) {

                                    $("#continue").prop("disabled", false);

                                }
                            
                            }

                            else {

                                if (localStorage.getItem("match_tight_last_column_one_clicked")) {

                                    showIncorrectDialog();

                                    $("button").filter((_, elem) => $(elem).text().trim() == localStorage.getItem("match_tight_last_column_one_clicked"))[0].disabled = false; 
                                    columnTwoBtn.disabled = false;

                                    $("button").filter((_, elem) => $(elem).text().trim() == localStorage.getItem("match_tight_last_column_one_clicked"))[0].style.backgroundColor = "";
                                    columnTwoBtn.style.backgroundColor = "";

                                    localStorage.removeItem("match_tight_last_column_one_clicked");
                                    localStorage.removeItem("match_tight_last_column_two_clicked");

                                }

                                else {

                                    columnTwoBtn.disabled = true;
                                    columnTwoBtn.style.backgroundColor = "lightgray";

                                    localStorage.setItem("match_tight_last_column_two_clicked", columnTwo[i]);

                                }

                            }

                        });

                        columnOneElem.appendChild(columnOneBtn);
                        columnTwoElem.appendChild(columnTwoBtn);

                        tableRow.appendChild(columnOneElem);
                        tableRow.appendChild(columnTwoElem);

                        table.appendChild(tableRow);

                    }

                    break;

                case "multiple-choice":

                    localStorage.removeItem("multiple_choice_correct_answer_index");

                    const question = exerciseData.data.question;
                    const possibleAnswers = exerciseData.data.possibleAnswers;
                    const correctAnswerIndex = exerciseData.data.correctAnswerIndex;

                    const questionElem = document.createElement("p");
                    questionElem.textContent = question;

                    exerciseDiv.appendChild(questionElem);

                    const mcDiv = document.createElement("div");

                    mcDiv.id = "multiple-choice-div"

                    exerciseDiv.appendChild(mcDiv);

                    for (let i = 0; i < possibleAnswers.length; i++) {

                        const selectionDiv = document.createElement("div");

                        selectionDiv.id = "exerciseMCSelectionDiv"

                        const radio = document.createElement("input");
                        const label = document.createElement("label");

                        radio.type = "radio";
                        radio.id = `mc${i}`;
                        radio.name = "exercise-multiple-choice";

                        label.for = `mc${i}`;
                        label.textContent = possibleAnswers[i];

                        selectionDiv.appendChild(radio);
                        selectionDiv.appendChild(label);

                        mcDiv.appendChild(selectionDiv);

                        if (i == correctAnswerIndex) {

                            radio.addEventListener("change", function () {

                                showCorrectDialog();

                                $("#continue").prop("disabled", false);

                                document.querySelectorAll("input[type=radio]").forEach((elem) => { elem.disabled = true })

                            });

                        }

                        else {

                            radio.addEventListener("change", function () {

                                showIncorrectDialog();

                            });

                        }

                    }

                    break;
                    
                default:

                    $("#error").text("Invalid exercise type.");

                    break;

            }

            break;

        case "q":

            $("#video").hide();
            $("#paragraph").hide();
            $("#exercise").hide();
            $("#quiz").show();

            $("#continue").on("click", showQuizScore);

            $("#continue").prop("disabled", false);

            const quizCourseContentData = {

                contentID,
                courseID

            };

            const quizCourseContentReq = {

                method: "POST",
        
                headers: {
        
                    "Content-Type": "application/json"
        
                },
        
                body: JSON.stringify(quizCourseContentData)
        
            };;

            const quizCourseContentRes = await (await fetch("/getLessonChunkContent", quizCourseContentReq)).json();

            const quizData = JSON.parse(quizCourseContentRes.data);

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

                        mcLegend.textContent = question.questionText;

                        const possibleAnswers = question.possibleAnswers;

                        for (let j = 0; j < possibleAnswers.length; j++) {

                            const possibleAnswerDiv = document.createElement("div");

                            possibleAnswerDiv.classList = "quizMCAnswerDiv"

                            const answerInputElem = document.createElement("input");
                            const answerLabelElem = document.createElement("label");

                            answerInputElem.type = "radio";
                            answerInputElem.id = `mcAnswer${i}-${j}`;
                            answerInputElem.name = `mcAnswer${i}`;
                            answerInputElem.classList = "quizInput"
                            answerInputElem.value = possibleAnswers[j];

                            if (j == 0) {

                                answerInputElem.checked = true;

                            }

                            answerLabelElem.for = `mcAnswer${i}`;
                            answerLabelElem.textContent = possibleAnswers[j];

                            possibleAnswerDiv.appendChild(answerInputElem);
                            possibleAnswerDiv.appendChild(answerLabelElem);

                            mcFieldset.appendChild(possibleAnswerDiv)

                        }

                        tr.appendChild(mcFieldset);

                        break;

                }

                questionTable.appendChild(tr);

            }

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

});