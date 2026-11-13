// The tone tags page (src/pages/tonetags.astro) made searchable: as the box is typed in, the tags
// that do not answer fold away and those that do stay where they are in the alphabet. A letter with
// nothing left under it folds away too, and so does the strip of everyday tags while a search is on. The matching itself is in src/tonetags/tags.ts.

import { match, tags } from "../tonetags/tags";

const root = document.querySelector<HTMLElement>("[data-tonetags]");
if (root) {
    const box = root.querySelector<HTMLInputElement>("input")!;
    const count = root.querySelector<HTMLElement>(".tonetags-count")!;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-tag]")];
    const letters = [...root.querySelectorAll<HTMLElement>(".tonetags-letter")];
    const everyday = root.querySelector<HTMLElement>(".tonetags-everyday")!;

    const fold = (part: HTMLElement, open: boolean) => {
        part.classList.toggle("open", open);
        // what is folded away is out of the way of the keyboard and of screen readers too
        part.inert = !open;
    };

    const show = () => {
        const looking = box.value.trim() !== "";
        let found = 0;
        for (const row of rows) {
            const answers = match(tags[Number(row.dataset.tag)]!, box.value) > 0;
            fold(row, answers);
            if (answers) found++;
        }
        // a letter with nothing left under it goes with its tags, and the strip stands aside for a search
        for (const letter of letters) fold(letter, letter.querySelector("[data-tag].open") !== null);
        fold(everyday, !looking);
        count.textContent = !looking ? "" : found === 0 ? "No tag matches that." : found === 1 ? "1 tag" : `${found} tags`;
    };

    box.addEventListener("input", show);
    // a tag in the address is looked up at once: /tonetags/?q=srs
    const asked = new URLSearchParams(location.search).get("q");
    if (asked) box.value = asked;
    show();
}
