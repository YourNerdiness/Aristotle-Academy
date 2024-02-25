$("#updateSub-btn").on("click", () => {

    $("#createSubError").text("");

    const data = { item : $("#numStudents").val(), password : $("#subPasswordField").val() };

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

            if (data.item == "none-sub") {

                window.location.reload();

            }

            else {

                window.location.href = (await res.json()).url;

            }

        }

        else {

            const error = await res.json();

            $("#createSubError").text(error.userMsg || error.msg || "An error has occurred.");

        }
    
    });

});

const removeStudentCallback = async (studentToRemove) => {

    const data = { studentUsername: studentToRemove };

    const req = {

        method: "POST",

        headers: {

            "Content-Type": "application/json"

        },

        body: JSON.stringify(data)

    };

    document.getElementById("loadingDialog").showModal();

    const res = await fetch("/adminDeleteSchoolStudent", req);

    document.getElementById("loadingDialog").close();

    if (!res.ok) {

        const error = await res.json();

        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }

    else {

        window.location.reload();

    }

}

const generateStudentElems = async () => {

    document.getElementById("loadingDialog").showModal();

    const res = await fetch("/getSchoolStudentList");

    document.getElementById("loadingDialog").close();

    if (!res.ok) {

        const error = await res.json();

        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }

    else {

        const data = await res.json();

        const studentUsernames = data.studentUsernames;

        for (let i = 0; i < studentUsernames.length; i++) {

            const tr = $("<tr>");

            const usernameElem = $("<td>").text(studentUsernames[i]);
            const buttonElem = $("<td>").append($("<button>").text("Remove Student From School").click(() => { removeStudentCallback(studentUsernames[i]) }));

            tr.append(usernameElem)
            tr.append(buttonElem)

            $("#schoolTable").append(tr);

        }

    }

}

generateStudentElems();