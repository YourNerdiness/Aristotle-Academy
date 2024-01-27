const signup = async () => {

    const username = document.getElementById("username").value;
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    if (!username || !email || !password) {

        document.getElementById("error").textContent = "Mising sign up data.";

        return;

    }

    const data = { username, email, password };

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