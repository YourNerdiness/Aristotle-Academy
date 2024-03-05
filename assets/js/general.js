window.onload = () => {

    if ((localStorage.getItem("consented") != "true") && window.location.pathname != "/tc" && window.location.pathname != "/privacy") {

        document.getElementById("consentDialog").showModal();

    }

    const redirectError = new URLSearchParams(window.location.search).get("redirectError");

    if (redirectError) {

        $("#redirectErrorText").text(redirectError);

        document.getElementById("redirectErrorDialog").show()

        setTimeout(() => { document.getElementById("redirectErrorDialog").close() }, 10000)

    }

};

window.onbeforeunload = () => {

    document.getElementById("loadingDialog").showModal();

};