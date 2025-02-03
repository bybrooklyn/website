// Toggle the navigation menu and theme
document.addEventListener("DOMContentLoaded", function () {
    var menuToggle = document.getElementById("menu-toggle");
    var mainNav = document.getElementById("main-nav");
    var themeToggle = document.getElementById("theme-toggle");
    var body = document.body;

    // Menu toggle functionality
    menuToggle.addEventListener("click", function () {
        mainNav.classList.toggle("open");
    });

    // Theme toggle functionality
    themeToggle.addEventListener("click", function () {
        // Toggle between 'light' and 'dark' themes
        var currentTheme = body.getAttribute("data-theme") || "light";
        var newTheme = currentTheme === "dark" ? "light" : "dark";
        body.setAttribute("data-theme", newTheme);
        localStorage.setItem("theme", newTheme);
    });

    // On page load, set the theme from localStorage or system preference
    var storedTheme = localStorage.getItem("theme");
    if (storedTheme) {
        body.setAttribute("data-theme", storedTheme);
    } else {
        // Detect system preference
        var prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)").matches;
        var defaultTheme = prefersDarkScheme ? "dark" : "light";
        body.setAttribute("data-theme", defaultTheme);
    }

    // Listen for changes in the system color scheme
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function (e) {
        var storedTheme = localStorage.getItem("theme");
        if (!storedTheme) {
            var newColorScheme = e.matches ? "dark" : "light";
            body.setAttribute("data-theme", newColorScheme);
        }
    });
});
