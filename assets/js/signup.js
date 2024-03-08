let isAdminAccount = false;

const setAccountType = (isAdmin) => {

    isAdminAccount = isAdmin;

    if (isAdmin) {

        document.getElementById("accountTypeIndividual").style.borderColor = "#bbb";
        document.getElementById("accountTypeAdmin").style.borderColor = "blue";

    }

    else {

        document.getElementById("accountTypeIndividual").style.borderColor = "blue";
        document.getElementById("accountTypeAdmin").style.borderColor = "#bbb";

    }

};

const signup = async () => {

    const username = document.getElementById("username").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    if (!username || !email || !password) {

        document.getElementById("error").textContent = "Missing sign up data.";

        return;

    }

    const data = { username, email, password, accountType : isAdminAccount ? "admin" : "individual" };

    const req = {

        method : "POST",

        headers : {

            "Content-Type" : "application/json"

        },

        body : JSON.stringify(data)

    }

    document.getElementById("loadingDialog").showModal();

    const res = await fetch("./signup", req);

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

    if (!(/^[0-9A-Fa-f]+$/.test(code)) || code.length != 8) {

        $("#mfaError").text("MFA code invalid.");

        return;

    }

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