// Runs inline in every page's head, before anything is drawn. It is a file of
// its own so that astro.config.ts can read the same text and allow exactly
// this script in the content security policy.
//
// Tells the page transition which way it is going, so motion.css can
// slide the site aside when something opens and bring it back on close.
// A post or a project is "opened"; every other page is a main page.
// Main pages also have an order, the nav's: going to one further
// along moves one way, going back along it moves the other.
(() => {
    // The main pages in nav order, home first, from the <html> element.
    const order = (document.documentElement.dataset.order || "/").split(" ");
    const path = (url) => new URL(url).pathname;
    const opened = (url) => /^\/(blog|projects)\/[^/]+\/$/.test(path(url));
    const place = (url) => order.findLastIndex((href) => (href === "/" ? path(url) === "/" : path(url).startsWith(href)));
    const kinds = (from, to) => {
        const kind = opened(to) ? (opened(from) ? "swap" : "open") : opened(from) ? "close" : "move";
        return kind === "move" && place(to) < place(from) ? [kind, "back"] : [kind];
    };
    const label = (transition, from, to) => {
        // A link to the page you are already on is not a change of page.
        if (path(from) === path(to)) transition.skipTransition();
        else for (const kind of kinds(from, to)) transition.types.add(kind);
    };
    addEventListener("pageswap", (event) => {
        // Remembered for browsers that cannot say where a page was reached from.
        try {
            sessionStorage.setItem("left", location.href);
        } catch {}
        if (event.viewTransition && event.activation) label(event.viewTransition, location.href, event.activation.entry.url);
    });
    addEventListener("pagereveal", (event) => {
        if (!event.viewTransition) return;
        const activation = window.navigation && navigation.activation;
        let from = activation && activation.from ? activation.from.url : null;
        if (!from) {
            try {
                from = sessionStorage.getItem("left");
            } catch {}
        }
        if (from && new URL(from).origin === location.origin) label(event.viewTransition, from, location.href);
    });

    // A browser that cannot carry a transition from one page to the next
    // (Firefox) gets the second half of it: the page it leaves is noted, and
    // the page it arrives on is marked with the kind of change, which
    // motion.css turns into the panel sliding in or the content shifting.
    if (!("onpagereveal" in window)) {
        addEventListener("pagehide", () => {
            try {
                sessionStorage.setItem("left", location.href);
            } catch {}
        });
        let from = null;
        try {
            from = sessionStorage.getItem("left");
            sessionStorage.removeItem("left");
        } catch {}
        // Only when this page was reached from that one, not when it was reopened later.
        const came = document.referrer && new URL(document.referrer).origin === location.origin;
        if (from && came && new URL(from).origin === location.origin && path(from) !== path(location.href)) {
            const root = document.documentElement;
            root.dataset.arrive = kinds(from, location.href).join(" ");
            addEventListener("DOMContentLoaded", () => setTimeout(() => delete root.dataset.arrive, 800));
        }
    }
})();

