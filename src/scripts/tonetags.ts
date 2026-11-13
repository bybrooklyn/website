// The tone tags page (src/pages/tonetags.astro) made searchable: as the box is typed in, the tags
// that do not answer fold away and those that do come to the top, the closest first. It can be
// searched by a tag's letters or by what is meant ("not angry at you"). The strip of everyday tags
// folds away while a search is on. A tag pressed is copied; "/" goes to the search; and a tag named
// after # in the address is lit. The matching itself is in src/tonetags/tags.ts.

import { find, tags } from "../tonetags/tags";
import { copyMarked, copyText } from "./copy";

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
    // the link carries what is being searched for, so that whoever opens it sees the same tags
    // (the page has no such button at present; this is kept for when one is wanted again, with its styles in tonetags.css)
    const copy = root.querySelector<HTMLButtonElement>(".tonetags-copy");
    copy?.addEventListener("click", () => {
        const here = new URL(location.pathname, location.origin);
        if (box.value.trim()) here.searchParams.set("q", box.value.trim());
        copyMarked(copy, here.href);
    });
    // a tag pressed is copied, slash and all, ready to put after a message
    root.addEventListener("click", (event) => {
        const tag = (event.target as Element).closest<HTMLButtonElement>(".tonetag-tag");
        if (tag?.dataset.copy) copyText(tag, tag.dataset.copy, { rest: tag.dataset.copy, done: "copied" });
    });

    // "/" from anywhere on the page goes to the search, where it is the first thing typed; Escape there empties it
    document.addEventListener("keydown", (event) => {
        const typing = (event.target as Element).closest("input, textarea, [contenteditable]");
        if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) box.focus();
        if (event.key === "Escape" && event.target === box && box.value) {
            box.value = "";
            show();
        }
    });

    // a tag named in the address is brought into view and lit for a moment: /tonetags/#srs
    const light = () => {
        const named = decodeURIComponent(location.hash.slice(1)).toLowerCase().replace(/^\//, "");
        const row = named && rows.find((each) => each.dataset.forms!.split(" ").includes(named));
        if (!row) return;
        if (box.value) {
            box.value = "";
            show();
        }
        row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        row.classList.remove("lit");
        void row.offsetWidth;
        row.classList.add("lit");
    };
    addEventListener("hashchange", light);

    // a tag in the address is looked up at once: /tonetags/?q=srs
    const asked = new URLSearchParams(location.search).get("q");
    if (asked) box.value = asked;
    show();
    light();
}
