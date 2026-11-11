// Starts the mini named by each `data-mini` element on the page. A mini is a
// file in src/minis/ whose default export sets a scene up on Mote; it is only
// fetched on a page that shows it.

import { mote, type Mote, type Scene } from "../mote/stage";

const minis = import.meta.glob<{ default: (m: Mote) => Scene; label?: string }>("../minis/*.ts");

for (const host of document.querySelectorAll<HTMLElement>("[data-mini]")) {
    const load = minis[`../minis/${host.dataset.mini}.ts`];
    if (load) void load().then((mini) => mote(host, mini.default, { label: mini.label, preview: host.hasAttribute("data-preview") }));
}
