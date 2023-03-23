let courseList;
let courseDescriptions;
let courseTags;

const getcourseList = async () => {

    const req = {

        headers : {

            "Content-Type" : "application/json",

            filter : document.getElementById("paidOnly").checked.toString()

        }

    }

    const res = await fetch("/getcourseList", req);

    if (!res.ok) {

        document.getElementById("error").textcourse = await res.text();

        if(res.status == 401) {

            document.getElementById("paidOnly").checked = false;

        }

    }

    else {

        const courseData = await (res).json();

        courseList = courseData.courseList;
        courseDescriptions = courseData.courseDescriptions;
        courseTags = courseData.courseTags;

        generatecourseElems();

    }

}

const getFilterTags = () => {

    const filterElems = Array.from(document.getElementsByClassName("filterElems"));
    const filterElemLabels = Array.from(document.getElementsByClassName("filterElemsL"));

    const filterTags = [];

    for (let i = 0; i < filterElems.length; i++) {

        if (filterElems[i].checked) {

            filterTags.push(filterElemLabels[i].textContent);

        }

    }

    return filterTags;

}

const generatecourseElems = () => {

    document.getElementById("error").textContent = "";

    const rowLength = Math.round(window.innerWidth/400);

    const table = document.getElementById("courseList");

    while (table.firstChild) {

        table.removeChild(table.firstChild);

    }

    const filterTags = getFilterTags();

    const courseListTemp = [...courseList];

    if (filterTags.length != 0) {

        for (let i = 0; i < courseListTemp.length; i++) {

            const elemTags = courseTags[courseListTemp[i]];

            console.log(filterTags);

            for (let j = 0; j < filterTags.length; j++) {

                if (elemTags.indexOf(filterTags[j]) == -1) {

                    console.log(j)

                    courseListTemp.splice(i, 1);

                    i--;

                    break;

                }

            }

        }

    }

    for (let i = 0; i < courseListTemp.length; i += rowLength) {

        const tableRow = document.createElement("tr");

        for (let j = i; j < Math.min(i + rowLength, courseListTemp.length); j++) {

            const tableData = document.createElement("td");

            const div = document.createElement("div");
            const link = document.createElement("a");

            link.href = "http://localhost/course/" + encodeURIComponent(courseListTemp[j]) + "/info.html";

            const title = document.createElement("h4");
            const description = document.createElement("h5");

            title.textcourse = courseListTemp[j];
            description.textcourse = courseDescriptions[courseListTemp[j]];

            link.appendChild(title);

            div.appendChild(link);
            div.appendChild(description);

            tableData.appendChild(div);

            tableRow.appendChild(tableData);

        }

        table.append(tableRow);

    }

}

window.onload = getcourseList;
window.onresize = generatecourseElems;