$(document).ready(function () {

    const courseName = new URLSearchParams(window.location.search).get("courseName");

    $(".checkout-btn").click((event) => {

        let item;

        switch ($(event.target).attr("id")) {

            case "course-btn":
                
                item = courseName;

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

                $("#error").text(await res.text());

            }

        });

    });

});  