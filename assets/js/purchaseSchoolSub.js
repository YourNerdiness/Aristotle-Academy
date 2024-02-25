$(document).ready(() => {

    $("#submit").on("click", () => {

        $("#error").text("");

        const data = { item : $("#numStudents").val(), ipAddr : $("#ipAddr").val(), schoolName : $("#schoolName").val(), password : $("#password").val() };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        document.getElementById("loadingDialog").showModal();

        fetch("/buyRedirect", req).then(async res => {

            document.getElementById("loadingDialog").close();

            if (res.ok) {

                window.location.href = (await res.json()).url;

            }

            else {

                const error = await res.json();

                $("#error").text(error.userMsg || error.msg || "An error has occurred.");

            }
        
        });

    });

});