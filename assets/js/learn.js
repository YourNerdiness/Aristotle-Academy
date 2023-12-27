let courseData;
let courseIDs;
let courseTags;

const filterChildProperties = (obj, property) => {

    const keys = Object.keys(obj);

    const toReturn = {};

    for (let i = 0; i < keys.length; i++) {

        toReturn[keys[i]] = obj[keys[i]][property];

    }

    return toReturn;

};

const redirectCallback = async (courseID) => {

    const data = { courseID };

    const req = {

        method : "POST",

        headers : {

            "Content-Type" : "application/json"

        },

        body : JSON.stringify(data)

    };

    const res = await fetch("/learnRedirect", req);

    if (res.ok) {

        window.location.href = (await res.json()).url;

    }

    else {

        const error = await res.json();

        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }

};

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

const generateFiltertags = () => {

    const navElem = document.querySelectorAll("main > nav")[1];

    for (let i = 0; i < courseTags.length; i++) {

        const label = document.createElement("label");
        const checkbox = document.createElement("input");

        label.htmlFor = courseTags[i];
        label.className = "filterElemsL";
        label.textContent = courseTags[i];

        checkbox.type = "checkbox";
        checkbox.id = courseTags[i]
        checkbox.className = "filterElems";

        checkbox.addEventListener("change", generateCourseElems);

        navElem.appendChild(label);
        navElem.appendChild(checkbox);

    }

};

const generateCourseElems = () => {

    document.getElementById("error").textContent = "";

    const rowLength = Math.round(window.innerWidth/400);

    const table = document.getElementById("courseList");

    while (table.firstChild) {

        table.removeChild(table.firstChild);

    }

    const filterTags = getFilterTags();

    let filteredcourseIDs = [];

    for (let i = 0; i < courseIDs.length; i++) {

        const elemTags = courseData[courseIDs[i]].tags;

        let shouldFilter = true;

        for (let j = 0; j < filterTags.length; j++) {

            shouldFilter = shouldFilter && (elemTags.indexOf(filterTags[j]) == -1);

        }

        if (!shouldFilter) {

            filteredcourseIDs.push(courseIDs[i]);

        }

    }

    filteredcourseIDs = filterTags.length == 0 ? courseIDs : filteredcourseIDs;

    for (let i = 0; i < filteredcourseIDs.length; i += rowLength) {

        const tableRow = document.createElement("tr");

        for (let j = i; j < Math.min(i + rowLength, filteredcourseIDs.length); j++) {

            const tableData = document.createElement("td");

            const div = document.createElement("section");
            const btn = document.createElement("button");

            div.className = "display-container";
            btn.className = "course-title-btn center"

            btn.addEventListener("click", () => { redirectCallback(filteredcourseIDs[j]) });

            const title = document.createElement("h5");
            const description = document.createElement("p");

            title.className = "course-title";

            title.textContent = courseData[filteredcourseIDs[j]].title;
            description.textContent = courseData[filteredcourseIDs[j]].description;

            title.style.width = "300px"
            title.style.whiteSpace = "initial"

            btn.appendChild(title);

            div.appendChild(btn);
            div.appendChild(description);

            tableData.appendChild(div);

            tableRow.appendChild(tableData);

        }

        table.append(tableRow);

    }

}

const getCourseData = async () => {

    const req = {

        headers : {

            "Content-Type" : "application/json",

            filter : document.getElementById("paidOnly").checked.toString()

        }

    }

    const res = await fetch("/getCourseData", req);

    if (!res.ok) {

        const error = await res.json();

        if (res.status == 401) {

            document.getElementById("paidOnly").checked = false;

        }

        document.getElementById("error").textContent = error.userMsg || error.msg || "An error has occurred.";

        throw error.userMsg || error.msg || "An error has occurred.";

    }

    else {

        const data = await (res).json();

        courseData = data.courseData;
        courseIDs = data.courseIDs;
        courseTags = Object.values(filterChildProperties(courseData, "tags")).flat().sort()

    }

};

const getGenerateCourseElems = () => {

    getCourseData().then(() => { generateCourseElems() });


};

const init = async () => {

    await getCourseData();

    generateFiltertags();

    generateCourseElems();

};

window.onresize = generateCourseElems;

init();