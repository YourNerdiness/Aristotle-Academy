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

    // useClass is a class set to show and hide img elements and the input element of the password, meant to distinguish multiple password inputs in a document

    $(".showPassword").click(function(event) {

        const classList = $(this).attr("class");

        const useClass = classList.split(" ").filter((val) => val != "showPassword")[0]

        $(`.showPassword.${useClass}`).hide();
        $(`.hidePassword.${useClass}`).show();
        $(`input.${useClass}`).attr("type", "text")

    });

    $(".hidePassword").click(function(event) {

        const classList = $(this).attr("class");

        const useClass = classList.split(" ").filter((val) => val != "hidePassword")[0]

        $(`.showPassword.${useClass}`).show();
        $(`.hidePassword.${useClass}`).hide();
        $(`input.${useClass}`).attr("type", "password")

    });

};

window.onbeforeunload = () => {

    document.getElementById("loadingDialog").showModal();

};