let courseNames;
let courseDescriptions;
let courseTags;

const redirectCallback = async (courseName) => {

    const data = { courseName };

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

    let tags = [];

    const keys = Object.keys(courseTags);

    for (let i = 0; i < keys.length; i++) {

        tags = tags.concat(courseTags[keys[i]])

    }

    tags = Array.from(new Set(tags));

    const navElem = document.querySelectorAll("main > nav")[1];

    for (let i = 0; i < tags.length; i++) {

        const label = document.createElement("label");
        const checkbox = document.createElement("input");

        label.htmlFor = tags[i];
        label.className = "filterElemsL";
        label.textContent = tags[i];

        checkbox.type = "checkbox";
        checkbox.id = tags[i]
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

    let filteredcourseNames = [];

    for (let i = 0; i < courseNames.length; i++) {

        const elemTags = courseTags[courseNames[i]];

        let shouldFilter = true;

        for (let j = 0; j < filterTags.length; j++) {

            shouldFilter = shouldFilter && (elemTags.indexOf(filterTags[j]) == -1);

        }

        if (!shouldFilter) {

            filteredcourseNames.push(courseNames[i]);

        }

    }

    filteredcourseNames = filteredcourseNames.length == 0 ? courseNames : filteredcourseNames;

    for (let i = 0; i < filteredcourseNames.length; i += rowLength) {

        const tableRow = document.createElement("tr");

        for (let j = i; j < Math.min(i + rowLength, filteredcourseNames.length); j++) {

            const tableData = document.createElement("td");

            const div = document.createElement("section");
            const btn = document.createElement("button");

            div.className = "display-container";
            btn.className = "course-title"

            btn.addEventListener("click", () => { redirectCallback(filteredcourseNames[j]) });

            const title = document.createElement("h4");
            const description = document.createElement("h5");

            title.textContent = filteredcourseNames[j];
            description.textContent = courseDescriptions[filteredcourseNames[j]];

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

        $("#error").text(error.userMsg || error.msg || "An error has occurred.");

    }

    else {

        const courseData = await (res).json();

        courseNames = courseData.courseNames;
        courseDescriptions = courseData.courseDescriptions;
        courseTags = courseData.courseTags;

    }

};

const getGenerateCourseElems = async () => {

    await getCourseData();

    generateCourseElems();

};

const init = async () => {

    await getCourseData();

    generateFiltertags();

    generateCourseElems();

};

window.onresize = generateCourseElems;

init();