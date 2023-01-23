const redirectToSignin = async () => {

    let res = await fetch("/checkIfLoggedIn");

    if (res.ok) {

        res = await res.json();

        if (res.loggedIn == "false") {

            window.location.href = "./signup.html"

        }

    }

    else {

        window.location.href = "./signup.html"

    }

}

redirectToSignin();