let time;

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

            break;

        case "p":

            $("#paragraph").html(await (await fetch("https://coursecontent.aristotle.academy" + contentIDParts[0])).text());

            $("#video").hide()
            $("#paragraph").show()
            $("#exercise").hide()

            break;

        case "e":

            $("#exercise").html(await (await fetch("https://coursecontent.aristotle.academy" + contentIDParts[0])).text());

            $("#video").hide()
            $("#paragraph").hide()
            $("#exercise").show()

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