let recoveryMethod = "email";

$(document).ready(function () {

    $("#recoveryMethod").change(() => {

        $("#error").text("");

        $(".submitVal-btn").prop("disabled", true);
        $("#emailDiv").show().css("visibility", "hidden");
        $("#usernameDiv").hide().css("visibility", "hidden");
        $('#newPasswordDiv').css("visibility", "hidden");

    });

    $(".val").change(() => {

        $("#error").text("");

        $(".submitVal-btn").prop("disabled", false);
        $('#newPasswordDiv').css("visibility", "hidden");

    });

    $("#submitRecoveryMethod-btn").click(() => {

        $("#error").text("");

        recoveryMethod = $("#recoveryMethod").val();

        $(".submitVal-btn").prop("disabled", false);
        $(recoveryMethod == "email" ? "#emailDiv" : "#usernameDiv").show().css("visibility", "visible");
        $(recoveryMethod == "email" ? "#usernameDiv" : "#emailDiv").hide().css("visibility", "hidden");
        $('#newPasswordDiv').css("visibility", "hidden");

    })

    $(".submitVal-btn").click(() => {

        $("#error").text("");

        const data = { val : $("#" + recoveryMethod).val(), recoveryMethod };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        fetch("/sendPasswordResetEmail", req).then(async res => {

            if (res.ok) {

                $(".submitVal-btn").prop("disabled", true);
                $('#newPasswordDiv').css("visibility", "visible");

            }

            else {

                const error = await res.json();

                $("#error").text(error.userMsg || error.msg || "An error has occurred.");

                $(".submitVal-btn").prop("disabled", true);
                $('#newPasswordDiv').css("visibility", "hidden");

            }
        
        });

    });

    $("#submitNewPassword-btn").click(() => {

        $("#error").text("");

        const data = { newPassword : $("#password").val(), code : $("#code").val() };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        fetch("/resetPassword", req).then(async res => {

            if (res.ok) {

                window.location.href = "/signin"

            }

            else {

                const error = await res.json();

                $("#error").text(error.userMsg || error.msg || "An error has occurred.");

            }
        
        });

    })

});  