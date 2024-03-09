$(document).ready(function () {

    const observer = new IntersectionObserver((entries) => {

        entries.forEach(entry => {

            if (entry.isIntersecting) {

                entry.target.classList.remove("fade-out");
                entry.target.classList.add("fade-in");

            }

            else {

                entry.target.classList.remove("fade-in");
                entry.target.classList.add("fade-out");

            }

        });

    }, { threshold: 0.5 });

    document.querySelectorAll(".sect").forEach(el => observer.observe(el));

});