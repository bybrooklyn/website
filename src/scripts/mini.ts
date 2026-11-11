// Starts the mini named by each `data-mini` element on the page. A mini is a
// file in src/minis/ whose default export sets a scene up on Mote. It is only
// fetched on a page that shows it, and only once it is scrolled near, so a
// list of them does not fetch them all at once.

import { mote, type Mote, type Scene } from "../mote/stage";

const minis = import.meta.glob<{ default: (m: Mote) => Scene; label?: string }>("../minis/*.ts");

const near = new IntersectionObserver(
    (entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const host = entry.target as HTMLElement;
            near.unobserve(host);
            const load = minis[`../minis/${host.dataset.mini}.ts`];
            if (load) void load().then((mini) => mote(host, mini.default, { label: mini.label, preview: host.hasAttribute("data-preview") }));
        }
    },
    { rootMargin: "300px" },
);
for (const host of document.querySelectorAll<HTMLElement>("[data-mini]")) near.observe(host);
