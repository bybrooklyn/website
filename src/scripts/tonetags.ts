// The tone tags page (src/pages/tonetags.astro) made searchable: as the box is typed in, the tags
// that do not answer fold away and those that do stay, the closest first. A part of the list with
// nothing left in it folds away with its heading. The matching itself is in src/tonetags/tags.ts.

import { match, tags } from "../tonetags/tags";

const root = document.querySelector<HTMLElement>("[data-tonetags]");
if (root) {
    const box = root.querySelector<HTMLInputElement>("input")!;
    const count = root.querySelector<HTMLElement>(".tonetags-count")!;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-tag]")];
    const parts = [...root.querySelectorAll<HTMLElement>(".tonetags-part")];

    const show = () => {
        let found = 0;
        for (const row of rows) {
            const score = match(tags[Number(row.dataset.tag)]!, box.value);
            row.classList.toggle("open", score > 0);
            // a folded row is out of the way of the keyboard and of screen readers too
            row.inert = score === 0;
            // the closest come to the top of their part; the rest keep the order they were written in
            row.style.order = String(3 - score);
            if (score > 0) found++;
        }
        for (const part of parts) {
            const any = part.querySelector("[data-tag].open") !== null;
            part.classList.toggle("open", any);
            part.inert = !any;
        }
        count.textContent = !box.value.trim() ? "" : found === 0 ? "No tag matches that." : found === 1 ? "1 tag" : `${found} tags`;
    };

    box.addEventListener("input", show);
    // a tag in the address is looked up at once: /tonetags/?q=srs
    const asked = new URLSearchParams(location.search).get("q");
    if (asked) box.value = asked;
    show();
}
