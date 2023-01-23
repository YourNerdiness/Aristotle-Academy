let contentList;
let contentDescriptions;
let contentTags;

const getContentList = async () => {

    const req = {

        headers : {

            "Content-Type" : "application/json",

            filter : document.getElementById("paidOnly").checked.toString()

        }

    }

    const res = await fetch("/getContentList", req);

    if (!res.ok) {

        document.getElementById("error").textContent = await res.text();

        if(res.status == 401) {

            document.getElementById("paidOnly").checked = false;

        }

    }

    else {

        const contentData = await (res).json();

        contentList = contentData.contentList;
        contentDescriptions = contentData.contentDescriptions;
        contentTags = contentData.contentTags;

        generateContentElems();

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

const generateContentElems = () => {

    document.getElementById("error").textContent = "";

    const rowLength = Math.round(window.innerWidth/400);

    const table = document.getElementById("contentList");

    while (table.firstChild) {

        table.removeChild(table.firstChild);

    }

    const filterTags = getFilterTags();

    const contentListTemp = [...contentList];

    if (filterTags.length != 0) {

        for (let i = 0; i < contentListTemp.length; i++) {

            const elemTags = contentTags[contentListTemp[i]];

            console.log(filterTags);

            for (let j = 0; j < filterTags.length; j++) {

                if (elemTags.indexOf(filterTags[j]) == -1) {

                    console.log(j)

                    contentListTemp.splice(i, 1);

                    i--;

                    break;

                }

            }

        }

    }

    for (let i = 0; i < contentListTemp.length; i += rowLength) {

        const tableRow = document.createElement("tr");

        for (let j = i; j < Math.min(i + rowLength, contentListTemp.length); j++) {

            const tableData = document.createElement("td");

            const div = document.createElement("div");
            const link = document.createElement("a");

            link.href = "http://localhost/content/" + encodeURIComponent(contentListTemp[j]) + "/info.html";

            const title = document.createElement("h4");
            const description = document.createElement("h5");

            title.textContent = contentListTemp[j];
            description.textContent = contentDescriptions[contentListTemp[j]];

            link.appendChild(title);

            div.appendChild(link);
            div.appendChild(description);

            tableData.appendChild(div);

            tableRow.appendChild(tableData);

        }

        table.append(tableRow);

    }

}

window.onload = getContentList;
window.onresize = generateContentElems;