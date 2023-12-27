$(document).ready(function () {

    const courseID = new URLSearchParams(window.location.search).get("courseID");

    $(".checkout-btn").click((event) => {

        let item;

        switch ($(event.target).attr("id")) {

            case "course-btn":
                
                item = courseID;

                break;
        
            case "monthly-btn":

                item = "monthly-sub";

                break;

            case "yearly-btn":

                item = "yearly-sub";

                break;

            default:

                break;

        }

        const data = { item, password : prompt("Please re-enter your password: ") };

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