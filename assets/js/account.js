$(document).ready(() => {

    $("#deleteAccount").click(() => {

        $("#error").text("");

        const data = { password : $("#deletePasswordField").val() };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        document.getElementById("loadingDialog").showModal();

        fetch("/deleteAccount", req).then(async res => {

            document.getElementById("loadingDialog").close();

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

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        document.getElementById("loadingDialog").showModal();

        fetch("/changeUserDetails", req).then(async res => {

            document.getElementById("loadingDialog").close();

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

        document.getElementById("loadingDialog").showModal();

        fetch("/changeUserDetails", req).then(async res => {

            document.getElementById("loadingDialog").close();

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

        document.getElementById("loadingDialog").showModal();

        fetch("/changeUserDetails", req).then(async res => {

            document.getElementById("loadingDialog").close();

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

        document.getElementById("loadingDialog").showModal();

        fetch("/signout").then(async res => {

            document.getElementById("loadingDialog").close();

            if (!res.ok) {

                const error = await res.json();

                $("#changePasswordError").text(error.userMsg || error.msg || "An error has occurred.");

            }

            else {

                window.location.href = "/";

            }
        
        });

    });

    $("#updateSub-btn").click((event) => {

        const data = { item : $('#newSubTypeField :selected').text().toLowerCase() + "-sub", password : $("#subPasswordField").val() };

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

                $("#createSubError").text(error.userMsg || error.msg || "An error has occurred.");

            }

        });

    });

    $("#updatePayment-btn").click((event) => {

        const data = { password : $("#updatePaymentPasswordField").val() };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        document.getElementById("loadingDialog").showModal();

        fetch("/updatePaymentDetails", req).then(async res => {

            document.getElementById("loadingDialog").close();

            if (res.ok) {

                window.location.href = (await res.json()).url;

            }

            else {

                const error = await res.json();

                $("#createSubError").text(error.userMsg || error.msg || "An error has occurred.");

            }

        });

    });

    $("#submitSchoolAccessCode").click((event) => {

        const data = { accessCode : $("#schoolAccessCode").val() };

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            },

            body : JSON.stringify(data)

        };

        document.getElementById("loadingDialog").showModal();

        fetch("/joinSchool", req).then(async res => {

            document.getElementById("loadingDialog").close();

            if (!res.ok) {

                const error = await res.json();

                $("#updateSchoolError").text(error.userMsg || error.msg || "An error has occurred.");

            }

            else {

                window.location.reload();

            }

        });

    });

    $("#leaveSchool-btn").click((event) => {

        const req = {

            method : "POST",

            headers : {

                "Content-Type" : "application/json"

            }

        };

        document.getElementById("loadingDialog").showModal();

        fetch("/leaveSchool", req).then(async res => {

            document.getElementById("loadingDialog").close();

            if (res.ok) {

                window.location.reload();

            }

            else {

                const error = await res.json();

                $("#updateSchoolError").text(error.userMsg || error.msg || "An error has occurred.");

            }

        });

    });

});