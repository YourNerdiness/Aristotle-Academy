$(document).ready(() => {

    $("#deleteAccount").click(() => {

        $("#error").text("");

        const data = { password : prompt("Please re-enter your password: ") };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        fetch("/deleteAccount", req).then(async res => {

            if (res.ok) {

                window.location.href = "/";

            }

            else {

                $("#error").text(await res.text());

            }
        
        });

    })

});