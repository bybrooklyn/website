// What the Insert menu adds beyond the blocks the bar already makes (a table, a picture, a line, a
// footnote, a page break, lists and links, in bar.ts and keys.ts): today's date, written as text
// in the site's date style; special characters, from a small grid written by hand and searched by
// name; and a table of contents made from the headings, which is made again when asked.
//
// A table of contents is a list of links to the headings, nested by level, after a marker that
// says it is one: `<!-- contents -->` in Markdown, `{/* contents */}` in MDX, which reads no HTML
// comments. The marker is invisible on her site and drawn as a quiet label in the editor, and it
// is how "Update the table of contents" finds the list to make again. The links go to the ids her
// site gives headings: the words in lower case, spaces as hyphens, punctuation left out, and a
// number after a heading that has the same words as one before it.

import { blockAt, insertBlock, outline, removeBlock, type Block, type Document, type List, type ListItem, type Raw } from "./document";
import type { State } from "./history";
import { handle } from "./keys";
import type { Surface } from "./surface";
import { make } from "../core/ui";

// ---- the date ----

/** A date as her site writes one, "November 12, 2026". */
export function dateText(date: Date): string {
    return date.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
}

/** Types text at the cursor, in place of what is selected, as if it were typed. */
export function typeIn(state: State, text: string): State {
    const outcome = handle(state, { type: "text", text });
    return outcome && "state" in outcome ? outcome.state : state;
}

// ---- special characters ----

/** A character and the words it is found by. */
export interface Special {
    char: string;
    name: string;
}

/** The groups of the grid, each a run of characters with their names, written by hand. */
export const SPECIALS: { group: string; chars: Special[] }[] = [
    {
        group: "Arrows",
        chars: [
            ["→", "right arrow"], ["←", "left arrow"], ["↑", "up arrow"], ["↓", "down arrow"], ["↔", "left right arrow"], ["↕", "up down arrow"],
            ["⇒", "double right arrow implies"], ["⇐", "double left arrow"], ["⇔", "double left right arrow if and only if"], ["↗", "north east arrow"], ["↘", "south east arrow"], ["↩", "return arrow"],
        ].map(([char, name]) => ({ char: char!, name: name! })),
    },
    {
        group: "Maths",
        chars: [
            ["×", "times multiply"], ["÷", "divide"], ["±", "plus minus"], ["−", "minus"], ["≈", "almost equal approximately"], ["≠", "not equal"], ["≤", "less than or equal"], ["≥", "greater than or equal"],
            ["∞", "infinity"], ["√", "square root"], ["∑", "sum sigma"], ["∏", "product"], ["∫", "integral"], ["∂", "partial"], ["∆", "delta increment"], ["π", "pi"],
            ["°", "degree"], ["‰", "per mille"], ["½", "one half"], ["⅓", "one third"], ["¼", "one quarter"], ["¾", "three quarters"], ["²", "squared superscript two"], ["³", "cubed superscript three"],
            ["∈", "element of in"], ["∉", "not an element of"], ["⊂", "subset"], ["∪", "union"], ["∩", "intersection"], ["∅", "empty set"], ["∀", "for all"], ["∃", "there exists"],
        ].map(([char, name]) => ({ char: char!, name: name! })),
    },
    {
        group: "Money",
        chars: [
            ["€", "euro"], ["£", "pound sterling"], ["¥", "yen yuan"], ["¢", "cent"], ["₹", "rupee"], ["₩", "won"], ["₽", "rouble"], ["₿", "bitcoin"], ["₺", "lira"], ["₱", "peso"], ["₪", "shekel"], ["¤", "currency"],
        ].map(([char, name]) => ({ char: char!, name: name! })),
    },
    {
        group: "Accents",
        chars: [
            ["é", "e acute"], ["è", "e grave"], ["ê", "e circumflex"], ["ë", "e diaeresis"], ["á", "a acute"], ["à", "a grave"], ["â", "a circumflex"], ["ä", "a umlaut"],
            ["å", "a ring"], ["ã", "a tilde"], ["æ", "ae ligature"], ["ç", "c cedilla"], ["í", "i acute"], ["ï", "i diaeresis"], ["ñ", "n tilde"], ["ó", "o acute"],
            ["ô", "o circumflex"], ["ö", "o umlaut"], ["ø", "o slash"], ["œ", "oe ligature"], ["ú", "u acute"], ["ü", "u umlaut"], ["ß", "sharp s eszett"], ["ÿ", "y diaeresis"],
            ["É", "capital e acute"], ["À", "capital a grave"], ["Ç", "capital c cedilla"], ["Ñ", "capital n tilde"], ["Ö", "capital o umlaut"], ["Ü", "capital u umlaut"], ["Ø", "capital o slash"], ["Å", "capital a ring"],
        ].map(([char, name]) => ({ char: char!, name: name! })),
    },
    {
        group: "Punctuation",
        chars: [
            ["“", "left double quote"], ["”", "right double quote"], ["‘", "left single quote"], ["’", "right single quote apostrophe"], ["«", "left guillemet"], ["»", "right guillemet"], ["…", "ellipsis"], ["·", "middle dot"],
            ["•", "bullet"], ["–", "en dash"], ["—", "em dash"], ["¶", "pilcrow paragraph"], ["§", "section"], ["†", "dagger"], ["‡", "double dagger"], ["©", "copyright"],
            ["®", "registered"], ["™", "trade mark"], ["¿", "inverted question"], ["¡", "inverted exclamation"], ["※", "reference mark"], ["‽", "interrobang"], ["★", "star"], ["✓", "check mark tick"],
        ].map(([char, name]) => ({ char: char!, name: name! })),
    },
];

/** The characters whose names (or the character itself) have every word searched for, grouped as the grid shows them. */
export function findSpecials(query: string): { group: string; chars: Special[] }[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return SPECIALS;
    return SPECIALS.map(({ group, chars }) => ({ group, chars: chars.filter((each) => each.char === query.trim() || words.every((word) => each.name.includes(word) || group.toLowerCase().startsWith(word))) })).filter((each) => each.chars.length > 0);
}

/** The grid of special characters, for a menu to hold: a search field over the groups, each character pressed to type it. */
export function specialGrid(choose: (char: string) => void): HTMLElement {
    const box = make("div", "quire-specials");
    const search = make("input", "quire-specials-search");
    search.type = "search";
    search.placeholder = "Search, as in arrow or euro";
    search.setAttribute("aria-label", "Search the special characters");
    search.spellcheck = false;
    const groups = make("div", "quire-specials-groups");
    const fill = () => {
        groups.replaceChildren();
        const found = findSpecials(search.value);
        if (found.length === 0) groups.append(make("p", "quire-specials-none", "Nothing by that name"));
        for (const { group, chars } of found) {
            groups.append(make("p", "quire-specials-group", group));
            const grid = make("div", "quire-specials-grid");
            for (const each of chars) {
                const button = make("button", "quire-special", each.char);
                button.type = "button";
                button.title = each.name;
                button.setAttribute("aria-label", each.name);
                button.addEventListener("mousedown", (event) => event.preventDefault());
                button.addEventListener("click", () => choose(each.char));
                grid.append(button);
            }
            groups.append(grid);
        }
    };
    search.addEventListener("input", fill);
    search.addEventListener("keydown", (event) => {
        // Enter types the first character found
        if (event.key !== "Enter") return;
        event.preventDefault();
        const first = findSpecials(search.value)[0]?.chars[0];
        if (first) choose(first.char);
    });
    fill();
    box.append(search, groups);
    return box;
}

/** Opens the grid in a menu from a control, typing what is chosen at the cursor and keeping the grid open for more. */
export function typeSpecial(surface: Surface): (char: string) => void {
    return (char) => surface.run((doc, selection) => typeIn({ doc, selection }, char), "type");
}

// ---- the table of contents ----

/** The marker before a table of contents, in Markdown and in MDX. */
export const CONTENTS = { md: "<!-- contents -->", mdx: "{/* contents */}" };

/** True for the block that marks a table of contents. */
export function isContentsMark(block: Block | undefined): boolean {
    return block?.kind === "raw" && (block.text.trim() === CONTENTS.md || block.text.trim() === CONTENTS.mdx);
}

/** The id her site gives a heading with these words, as GitHub's slugger makes it, numbered when the same words came before. */
export function slug(words: string, seen: Map<string, number>): string {
    const base = words
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s/g, "-");
    const count = seen.get(base);
    seen.set(base, (count ?? -1) + 1);
    return count === undefined ? base : `${base}-${count + 1}`;
}

/** The table of contents for a document: a list of links to its headings, nested by level. The title (a lone first-level heading at the top) is left out. */
export function contentsList(doc: Document): List | undefined {
    const seen = new Map<string, number>();
    const all = outline(doc).map((entry) => ({ ...entry, id: slug(entry.text, seen) }));
    const ones = all.filter((entry) => entry.level === 1);
    const headings = all.filter((entry) => entry.text && !(ones.length === 1 && entry.level === 1 && entry === all[0]));
    if (headings.length === 0) return undefined;
    const top = Math.min(...headings.map((entry) => entry.level));
    const make = (from: number, level: number): { items: ListItem[]; next: number } => {
        const items: ListItem[] = [];
        let at = from;
        while (at < headings.length && headings[at]!.level >= level) {
            const entry = headings[at]!;
            if (entry.level > level) {
                // a heading deeper than the one before it nests under that one's item
                const inner = make(at, entry.level);
                const owner = items[items.length - 1];
                const list: List = { kind: "list", style: "bullet", marker: "-", delimiter: ".", start: 1, loose: false, items: inner.items, gap: "" };
                if (owner) owner.blocks.push(list);
                else items.push({ blocks: [list], gap: "" });
                at = inner.next;
                continue;
            }
            items.push({ blocks: [{ kind: "paragraph", runs: [{ kind: "link", href: `#${entry.id}`, runs: [{ kind: "text", text: entry.text, marks: [] }] }], gap: "" }], gap: "" });
            at++;
        }
        return { items, next: at };
    };
    return { kind: "list", style: "bullet", marker: "-", delimiter: ".", start: 1, loose: false, items: make(0, top).items, gap: "" };
}

/** Where the table of contents is: the marker's place among the top-level blocks, and whether a list follows it. */
export function findContents(doc: Document): { mark: number; list: boolean } | undefined {
    const mark = doc.blocks.findIndex(isContentsMark);
    if (mark < 0) return undefined;
    return { mark, list: doc.blocks[mark + 1]?.kind === "list" };
}

/** Puts a table of contents after the cursor's top-level block: the marker and the list. With no headings yet, nothing is put. */
export function addContents(state: State): State {
    const list = contentsList(state.doc);
    if (!list) return state;
    const top = state.selection.focus.path[0] ?? 0;
    const mark: Raw = { kind: "raw", text: state.doc.mdx ? CONTENTS.mdx : CONTENTS.md, gap: "" };
    const here = blockAt(state.doc, [top]);
    const empty = here?.kind === "paragraph" && here.runs.length === 0;
    let doc = insertBlock(state.doc, [top], mark);
    doc = insertBlock(doc, [top + 1], list);
    // the cursor goes to an empty line after the list, so that what is put next goes after it, not between the marker and the list
    doc = insertBlock(doc, [top + 2], { kind: "paragraph", runs: [], gap: "" });
    if (empty) doc = removeBlock(doc, [top]);
    const at = empty ? top + 2 : top + 3;
    return { doc, selection: { anchor: { path: [at], offset: 0 }, focus: { path: [at], offset: 0 } } };
}

/** Makes the table of contents again from the headings as they are now; the rest of the document is untouched. */
export function updateContents(doc: Document): Document {
    const found = findContents(doc);
    const list = contentsList(doc);
    if (!found || !list) return doc;
    if (found.list) {
        const old = doc.blocks[found.mark + 1]!;
        let next = insertBlock(doc, [found.mark + 1], list);
        next = removeBlock(next, [found.mark + 1]);
        // the same list made again changes nothing, and keeps its source
        return JSON.stringify(stripped(next.blocks[found.mark + 1]!)) === JSON.stringify(stripped(old)) ? doc : next;
    }
    return insertBlock(doc, [found.mark], list);
}

/** A block without what says where it came from, to compare two lists by what they hold. */
function stripped(block: Block): unknown {
    return JSON.parse(JSON.stringify(block, (key, value) => (key === "source" || key === "gap" ? undefined : value)));
}
