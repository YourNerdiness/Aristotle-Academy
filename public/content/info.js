const getBuyButtons = async (contentName) => {

    const req = {

        headers : {

            "Content-Type" : "application/json",

            contentName

        }

    }

    const res = await fetch("/getLessonList", req);

    const buyButtons = Array.from(document.getElementsByClassName("buy"));

    if (!res.ok) {

        document.getElementById("error").textContent = await res.text();

        for (let i = 0; i < buyButtons.length; i++) {

            buyButtons[i].textContent = "Buy Now"

        }

    }

    else {

        const lessonList = (await res.json()).lessonList;

        while (lessonList.length < buyButtons.length - 1) {

            lessonList.push(false);

        }

        let fullCoursePaidFor = true;

        for (let i = 1; i < buyButtons.length; i++) {

            fullCoursePaidFor = fullCoursePaidFor && lessonList[i - 1];

            buyButtons[i].textContent = lessonList[i - 1] ? "Go To Lesson" : "Buy Now";

            if (lessonList[i - 1]) {

                buyButtons[i].setAttribute("onclick", "'window.location.href = /content.html?type=video'")

            }

            else {

                console.log("fkjsf");

                buyButtons[i].setAttribute("onclick", `getStripeURL('${contentName}', ${i})`);

            }

        }

        if (fullCoursePaidFor) {

            buyButtons[0].textContent = "You Have The Full Course!"

        }

        else {

            buyButtons[0].textContent = "Buy Now";

        }

    }

}

const getStripeURL = (contentName, i) => {

    const username = prompt("Please enter your username: ");
    const password = prompt("Please enter your password: ");

    const data = { username, password };

    const req = {

        method : "POST",

        headers : {

            "Content-Type" : "application/json"

        },

        body : JSON.stringify(data)

    }

    fetch(`/buyContent?name=${encodeURIComponent(contentName)}&i=${i}`, req).then(URLRes => {

        if (!URLRes.ok) {

            URLRes.text().then(errorText => {

                document.getElementById("error").textContent = errorText;

            });

            return "/info.html";

        }

        else {

            URLRes.json().then(stripeURL => {

                window.location.href = stripeURL.URL;

            });

        }

    });

}