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

        const data = { password : $("#usernamePasswordField").val(), toChangeValue : $("#newUsernameField").val(), toChangePropertyName : "username" };

        console.log(data)

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        fetch("/changeUserDetails", req).then(async res => {

            if (res.ok) {

                window.location.reload();

            }

            else {

                const error = await res.json();

                $("#changeUsernameError").text(error.userMsg || error.msg || "An error has occurred.");

            }
        
        });

    });

    $("#changeEmail").click(() => {

        $("#error").text("");

        const data = { password : $("#emailPasswordField").val(), toChangeValue : $("#newEmailField").val(), toChangePropertyName : "email" };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        fetch("/changeUserDetails", req).then(async res => {

            if (res.ok) {

                window.location.reload();

            }

            else {

                const error = await res.json();

                $("#changeEmailError").text(error.userMsg || error.msg || "An error has occurred.");

            }
        
        });

    });

    $("#changePassword").click(() => {

        $("#error").text("");

        const data = { password : $("#passwordPasswordField").val(), toChangeValue : $("#newPasswordField").val(), toChangePropertyName : "password" };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        fetch("/changeUserDetails", req).then(async res => {

            if (res.ok) {

                window.location.reload();

            }

            else {

                const error = await res.json();

                $("#changePasswordError").text(error.userMsg || error.msg || "An error has occurred.");

            }
        
        });

    });

    $("#signout").click(() => {

        $("#error").text("");

        const req = {

            method : "POST",

        };

        fetch("/signout", req).then(async res => {

            if (res.ok) {

                window.location.reload();

            }

            else {

                const error = await res.json();

                $("#changePasswordError").text(error.userMsg || error.msg || "An error has occurred.");

            }
        
        });

    });

    $("#updateSub-btn").click((event) => {

        const data = { item : $('#newSubTypeField :selected').text().toLowerCase() + "-sub", password : $("#reenterPasswordField").val() };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        fetch("/buyRedirect", req).then(async res => {

            if (res.ok) {

                window.location.href = (await res.json()).url;

            }

            else {

                const error = await res.json();

                $("#createSubError").text(error.userMsg || error.msg || "An error has occurred.");

            }

        });

    });

});