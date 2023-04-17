const redirectToSignin = async () => {

    let res = await fetch("/checkIfSignedIn");

    if (res.ok) {

        res = await res.json();

        if (!res.loggedIn) {

            window.location.href = "./signup.html"

        }

    }

    else {

        window.location.href = "./signup.html"

    }

}

redirectToSignin();