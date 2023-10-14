const signin = async () => {

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    if (!username || !password) {

        document.getElementById("error").textContent = "Mising sign in data.";

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

    let res = await fetch("./signin", req);

    if (res.ok) {

        window.location.reload();

    }

    else {

        const error = await res.json();

        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }

};