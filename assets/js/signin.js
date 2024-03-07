const signin = async () => {

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    if (!username || !password) {

        document.getElementById("error").textContent = "Missing sign in data.";

        return;

    }

    const data = { username, password };

    const req = {

        method : "POST",

        headers : {

            "Content-Type" : "application/json"

        },

        body : JSON.stringify(data)

    }

    document.getElementById("loadingDialog").showModal();

    let res = await fetch("./signin", req);

    document.getElementById("loadingDialog").close();

    if (res.ok) {

        document.getElementById("mfaDialog").showModal();

    }

    else {

        const error = await res.json();

        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }

};

const completeMFA = async () => {

    const code = document.getElementById("code").value;

    const data = { code };

    const req = {

        method : "POST",

        headers : {

            "Content-Type" : "application/json"

        },

        body : JSON.stringify(data)

    }

    document.getElementById("loadingDialog").showModal();

    const res = await fetch("./completeMFA", req);

    document.getElementById("loadingDialog").close();

    if (res.ok) {

        window.location.reload();

    }

    else {

        const error = await res.json();

        $("#mfaError").text(error.userMsg || error.msg || "An error has occurred.");

    }
    
};

window.onload = () => {

    const showMFA = new URLSearchParams(window.location.search).get("showMFA");

    if (showMFA === "true") {

        document.getElementById("mfaDialog").showModal();

    }

}