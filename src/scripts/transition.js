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
    // A few pages open like a project without being under /projects/; <html> lists them.
    const elsewhere = (document.documentElement.dataset.opened || "").split(" ").filter(Boolean);
    const opened = (url) => /^\/(blog|projects|minis)\/[^/]+\/$/.test(path(url)) || elsewhere.includes(path(url));
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
    // (Firefox) has the two halves played separately. On a click the page
    // being left plays its departure and only then is the link followed. The
    // page arrived at is marked with the kind of change and plays the arrival,
    // held at its starting position until the page has been laid out, so the
    // movement is not competing with the page loading. motion.css has both.
    if (!("onpagereveal" in window)) {
        const root = document.documentElement;
        const moves = matchMedia("(prefers-reduced-motion: no-preference)");
        const LEAVE = 200;

        addEventListener(
            "click",
            (event) => {
                const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
                if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                if (link.target || link.hasAttribute("download") || link.origin !== location.origin || !moves.matches) return;
                // The same page, or a place on it, is not a change of page.
                if (path(link.href) === path(location.href)) return;
                event.preventDefault();
                try {
                    sessionStorage.setItem("left", location.href);
                } catch {}
                root.dataset.leave = kinds(location.href, link.href).join(" ");
                setTimeout(() => location.assign(link.href), LEAVE);
            },
            // After the page's own handlers, which may have taken the click for themselves.
            false,
        );
        // Coming back with the back button brings this page out of memory as it was left: put it right.
        addEventListener("pageshow", () => delete root.dataset.leave);

        let from = null;
        try {
            from = sessionStorage.getItem("left");
            sessionStorage.removeItem("left");
        } catch {}
        // Only when this page was reached from that one, not when it was reopened later.
        const came = document.referrer && new URL(document.referrer).origin === location.origin;
        if (moves.matches && from && came && new URL(from).origin === location.origin && path(from) !== path(location.href)) {
            root.dataset.arrive = kinds(from, location.href).join(" ");
            root.dataset.hold = "";
            // Two frames after the page is parsed it has been laid out and painted once.
            addEventListener("DOMContentLoaded", () =>
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                        delete root.dataset.hold;
                        setTimeout(() => delete root.dataset.arrive, 800);
                    }),
                ),
            );
        }
    }
})();

