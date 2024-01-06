let item = "yearly-sub";

$(document).ready(function () {

    $("#checkout-btn").click((event) => {

        const data = { item, password : $("#reenterPasswordField").val() };

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

                $("#error").text(error.userMsg || error.msg || "An error has occurred.");

            }

        });

    });

});  