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

                const error = await res.json();

                $("#error").text(error.userMsg || error.msg || "An error has occurred.");

            }
        
        });

    })

    $("#changeUsername").click(() => {

        $("#error").text("");

        const data = { password : prompt("Please re-enter your password: "), toChangeValue : prompt("Please enter your new username: "), toChangePropertyName : "username" };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        fetch("/changeUserDetails", req).then(async res => {

            if (res.ok) {

                window.location.href = "/account";

            }

            else {

                const error = await res.json();

                $("#error").text(error.userMsg || error.msg || "An error has occurred.");

            }
        
        });

    })

});

$("#knowInfoToggle").hover(() => { document.getElementById("knowInfoDialog").show() }, () => { document.getElementById("knowInfoDialog").close() });
$("#haveInfoToggle").hover(() => { document.getElementById("haveInfoDialog").show() }, () => { document.getElementById("haveInfoDialog").close() });
$("#areInfoToggle").hover(() => { document.getElementById("areInfoDialog").show() }, () => { document.getElementById("areInfoDialog").close() });