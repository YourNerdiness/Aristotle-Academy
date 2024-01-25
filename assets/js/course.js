let time;

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

const sendSessionTimetoServer = (sessionTime=(Date.now()-Number(localStorage.getItem("sessionStartTime")))) => {

    fetch('/logSessionTime', {

        method: 'POST',

        body: JSON.stringify({ sessionTime }),

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
    time = setTimeout(sendSessionTimetoServer, 300000);

}

document.onmousemove = resetTimer;
document.onmousedown = resetTimer
document.onkeydown = resetTimer;
window.onbeforeunload = () => localStorage.setItem("lastSessionEndTime", Date.now());

window.onload = async () => {

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

        $("#error").text(res.userMsg || res.msg || "An error has occured.");

    }

    if (!(await res.json()).verified) {

        $("#error").text("Content route cannot be verified, possible XSS attack.");

        return;

    }

    switch (contentIDParts[0].split("/")[3][0]) {

        case "v":

            $("#video > source").first().attr("src", "https://coursecontent.aristotle.academy" + contentIDParts[0]);

            $("#video").show()
            $("#paragraph").hide()
            $("#exercise").hide()
            $("#quiz").hide()

            break;

        case "p":

            $("#paragraph").html(await (await fetch("https://coursecontent.aristotle.academy" + contentIDParts[0])).text());

            $("#video").hide()
            $("#paragraph").show()
            $("#exercise").hide()
            $("#quiz").hide()

            break;

        case "e":

            const exerciseData = await (await fetch("https://coursecontent.aristotle.academy" + contentIDParts[0])).json();

            $("#continue").prop("disabled", true);

            switch (exerciseData.type) {

                case "match-tight":

                    localStorage.removeItem("match_tight_last_column_one_clicked");
                    localStorage.removeItem("match_tight_last_column_two_clicked");
                    localStorage.removeItem("match_tight_num_matched");

                    const div = document.getElementById("exercise");

                    const pairs = exerciseData.data.pairs;
                    const description = exerciseData.data.description;

                    const p = document.createElement("p");

                    p.textContent = description;
                    p.classList = "center"

                    div.appendChild(p);

                    const columnOne = pairs.map(x => x[0]);
                    const columnTwo = pairs.map(x => x[1]);

                    utils.shuffleArray(columnOne);
                    utils.shuffleArray(columnTwo);

                    const table = document.createElement("table");

                    div.appendChild(table);

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

                                if (localStorage.getItem("match_tight_num_matched") >= pairs.length) {

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

                    break
                    
                default:

                    $("#error").text("Invalid exercise type.");

                    break;

            }

            $("#video").hide()
            $("#paragraph").hide()
            $("#exercise").show()
            $("#quiz").hide()

            break;

        case "q":

            const quizData = await (await fetch("https://coursecontent.aristotle.academy" + contentIDParts[0])).json();

            $("#video").hide()
            $("#paragraph").hide()
            $("#exercise").show()
            $("#quiz").hide()

            break;

        default:

            $("#error").text("Invalid content format.");

            break;

    }

    if (localStorage.getItem("lastSessionEndTime")) {

        if ((Number(localStorage.getItem("sessionStartTime")) || Number.POSITIVE_INFINITY) + 300000 <= Date.now()) {

            sendSessionTimetoServer(Number(localStorage.getItem("lastSessionEndTime")) - Number(localStorage.getItem("lastSessionStartTime")));
            
        }

        localStorage.removeItem("lastSessionEndTime")

    }

    resetTimer();

}