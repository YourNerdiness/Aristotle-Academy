let courseList;
let courseDescriptions;
let courseTags;

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

    let filteredCourseList = [];

    for (let i = 0; i < courseList.length; i++) {

        const elemTags = courseTags[courseList[i]];

        let shouldFilter = true;

        console.log(elemTags, filterTags);

        for (let j = 0; j < filterTags.length; j++) {

            shouldFilter = shouldFilter && (elemTags.indexOf(filterTags[j]) == -1);

        }

        console.log(shouldFilter);

        if (!shouldFilter) {

            filteredCourseList.push(courseList[i]);

        }

    }

    filteredCourseList = filteredCourseList.length == 0 ? courseList : filteredCourseList;

    for (let i = 0; i < filteredCourseList.length; i += rowLength) {

        const tableRow = document.createElement("tr");

        for (let j = i; j < Math.min(i + rowLength, filteredCourseList.length); j++) {

            const tableData = document.createElement("td");

            const div = document.createElement("div");
            const link = document.createElement("a");

            link.href = "http://localhost/course/" + encodeURIComponent(filteredCourseList[j]) + "/info.html";

            const title = document.createElement("h4");
            const description = document.createElement("h5");

            title.textContent = filteredCourseList[j];
            description.textContent = courseDescriptions[filteredCourseList[j]];

            link.appendChild(title);

            div.appendChild(link);
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

        document.getElementById("error").textContent = await res.text();

        if(res.status == 401) {

            document.getElementById("paidOnly").checked = false;

        }

    }

    else {

        const courseData = await (res).json();

        courseList = courseData.courseList;
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