$(document).ready(() => {

    $("#submit").on("click", () => {

        $("#error").text("");

        const data = { item : $("#numStudents").val(), domain : $("#domain").val(), schoolName : $("#schoolName").val(), password : $("#password").val() };

        if(!(/^[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-\.]+$/gm.test(data.domain))) {

            $("#error").text("Domain is invalid.");

        }

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