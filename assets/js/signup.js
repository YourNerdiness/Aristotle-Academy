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

    const res = await fetch("./signup", req);

    if (res.ok) {

        window.location.href = "./account.html";

    }

    else {

        document.getElementById("error").textContent = await res.text();

    }

};