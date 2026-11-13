// The tone tags page (src/pages/tonetags.astro) made searchable: as the box is typed in, the tags
// that do not answer fold away and those that do come to the top, the closest first. It can be
// searched by a tag's letters or by what is meant ("not angry at you"). The strip of everyday tags
// folds away while a search is on. The matching itself is in src/tonetags/tags.ts.

import { find, tags } from "../tonetags/tags";

const root = document.querySelector<HTMLElement>("[data-tonetags]");
if (root) {
    const box = root.querySelector<HTMLInputElement>("input")!;
    const count = root.querySelector<HTMLElement>(".tonetags-count")!;
    const rows = [...root.querySelectorAll<HTMLElement>("[data-tag]")];
    const everyday = root.querySelector<HTMLElement>(".tonetags-everyday")!;

    const fold = (part: HTMLElement, open: boolean) => {
        part.classList.toggle("open", open);
        // what is folded away is out of the way of the keyboard and of screen readers too
        part.inert = !open;
    };

    const list = rows[0]!.parentElement!;
    const show = () => {
        const looking = box.value.trim() !== "";
        // the tags that answer, the closest first; with nothing typed, all of them as they are written, A to Z
        const found = looking ? find(box.value).map((tag) => tags.indexOf(tag)) : [];
        const answers = new Set(found);
        for (const row of rows) fold(row, !looking || answers.has(Number(row.dataset.tag)));
        // what answers comes to the top in its order; the rest keep the alphabet under it, folded
        const rank = (row: HTMLElement) => (looking && answers.has(Number(row.dataset.tag)) ? found.indexOf(Number(row.dataset.tag)) : found.length + rows.indexOf(row));
        const ordered = rows.toSorted((a, b) => rank(a) - rank(b));
        if (ordered.some((row, place) => list.children[place] !== row)) list.append(...ordered);
        // the strip stands aside for a search
        fold(everyday, !looking);
        count.textContent = !looking ? "" : found.length === 0 ? "No tag matches that." : found.length === 1 ? "1 tag" : `${found.length} tags`;
    };

    box.addEventListener("input", show);
    // a tag in the address is looked up at once: /tonetags/?q=srs
    const asked = new URLSearchParams(location.search).get("q");
    if (asked) box.value = asked;
    show();
}
