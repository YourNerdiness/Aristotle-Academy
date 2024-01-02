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

    });

    $("#changeEmail").click(() => {

        $("#error").text("");

        const data = { password : prompt("Please re-enter your password: "), toChangeValue : prompt("Please enter your new email: "), toChangePropertyName : "email" };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        fetch("/changeUserDetails", req).then(async res => {

            if (!res.ok) {

                const error = await res.json();

                $("#error").text(error.userMsg || error.msg || "An error has occurred.");

            }
        
        });

    })

});