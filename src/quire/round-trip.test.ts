// What editing is held to, by random trial: whatever the writer does to a document, the Markdown
// written for it reads back as what she sees (the kinds of block and how they nest, the text, its
// marks, link addresses, list numbers and ticks, table cells), the selection always points at a place
// that exists, and nothing written is "undefined", "null", "NaN" or "[object Object]".
//
// The trials are seeded, so a failure repeats. The usual run makes a thousand runs of fifteen random
// edits, checking after every edit, and writes four thousand lines of randomly marked text;
// QUIRE_FUZZ=<number> runs that many times more (`QUIRE_FUZZ=20 bun test src/quire/round-trip.test.ts`),
// QUIRE_SEED starts from another seed, and QUIRE_ALL=1 counts every failure instead of stopping at five.

import { expect, test } from "bun:test";
import { blockAt, blockPaths, changeKind, insertBlock, lengthOf, list, removeBlock, runsText, setLink, setStyle, table, toggleMark, type Block, type Document, type Kind, type Leaf, type Mark, type Position, type Run, type Selection } from "./document";
import type { Action } from "./bar";
import { recase } from "./capitals";
import { continuePrevious, markWith, restartAt } from "./numbering";
import { emojiOf } from "./emoji";
import { createHistory, record } from "./history";
import { caret, fragment, paste, step, tableOf, type Editor, type Input } from "./keys";
import { read } from "./read";
import { write } from "./write";

const TIMES = Math.max(1, Number(process.env.QUIRE_FUZZ ?? 1));
const SEED = Number(process.env.QUIRE_SEED ?? 1);
/** How many failures to gather before stopping; QUIRE_ALL=1 counts every one. */
const ENOUGH = process.env.QUIRE_ALL ? Infinity : 5;

/** A small seeded generator, so that every failure can be run again from its seed. */
function generator(seed: number) {
    let state = seed >>> 0 || 1;
    const next = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
    return { next, pick };
}

// ---- what a writer sees ----

const pictograph = /\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u{FE0F}‍]/u;

/** Runs as a writer sees them: each character with its marks, links around, atoms by what they show. Spacing is one space, and none at the edges or beside a line break. */
function seenRuns(runs: Run[]): string {
    const out: string[] = [];
    const leaf = (each: Leaf, href: string) => {
        const link = href ? `@${href}` : "";
        if (each.kind === "text") {
            const look = [each.color ? `c=${each.color}` : "", each.size ? `s=${each.size}` : ""].filter(Boolean).join(",");
            for (const char of each.text) {
                if (/\s/.test(char)) out.push(" ");
                else out.push(`${char}{${pictograph.test(char) ? "" : [...each.marks].sort().join("+")}${look ? `;${look}` : ""}}${link}`);
            }
        } else if (each.kind === "emoji") for (const char of emojiOf(each.name) ?? `:${each.name}:`) out.push(`${char}{}${link}`);
        else if (each.kind === "break") out.push("\n");
        else if (each.kind === "image") out.push(`[image ${each.src} ${each.alt} ${each.title ?? ""}]${link}`);
        else if (each.kind === "footnote") out.push(`[^${each.label}]${link}`);
        else out.push(`[html ${each.html}]${link}`);
    };
    for (const run of runs) {
        if (run.kind === "link") for (const each of run.runs) leaf(each, run.href);
        else leaf(run, "");
    }
    // spacing: runs of spaces are one, and none at the edges or beside a break
    const spaced: string[] = [];
    for (const token of out) {
        if (token === " " && (spaced.length === 0 || spaced[spaced.length - 1] === " " || spaced[spaced.length - 1] === "\n")) continue;
        if (token === "\n" && spaced[spaced.length - 1] === " ") spaced.pop();
        spaced.push(token);
    }
    // a break at the very end has no Markdown form, and is not written (write.ts)
    while (spaced[spaced.length - 1] === " " || spaced[spaced.length - 1] === "\n") spaced.pop();
    return spaced.join("");
}

/** Whether a definition list can keep an item as it stands: a term with words, then definitions, a line of text each. */
const definable = (item: { blocks: Block[]; source?: string }) =>
    item.source !== undefined ||
    (item.blocks.length >= 2 && item.blocks.every((block) => block.kind === "paragraph" && !block.subtext && !block.align && !block.runs.some((run) => run.kind === "break")) && (item.blocks[0] as { runs: Run[] }).runs.some((run) => run.kind !== "text" || run.text.trim() !== ""));

/** Blocks as a writer sees them. Empty paragraphs are not seen; a paragraph holding only a picture is the picture. */
export function seen(blocks: Block[]): string {
    const one = (block: Block): string => {
        switch (block.kind) {
            case "paragraph": {
                const runs = seenRuns(block.runs);
                if (runs === "") return "";
                const only = block.runs.filter((run) => !(run.kind === "text" && run.text.trim() === ""));
                if (only.length === 1 && only[0]!.kind === "image" && !block.align && !block.subtext) return `image(${only[0]!.src} ${only[0]!.alt} ${only[0]!.title ?? ""})`;
                return `p${block.subtext ? "-#" : ""}${block.align ?? ""}(${runs})`;
            }
            case "heading":
                return `h${block.level}${block.align ?? ""}(${seenRuns(block.runs)})`;
            case "list": {
                // a definition list keeps only items of a term and its definitions, a line each; others are written as their blocks (write.ts)
                if (block.style === "definition" && !block.items.every(definable)) {
                    const parts: string[] = [];
                    let kept: typeof block.items = [];
                    const flush = () => {
                        if (kept.length) parts.push(one({ ...block, items: kept }));
                        kept = [];
                    };
                    for (const item of block.items) {
                        if (definable(item)) kept.push(item);
                        else {
                            flush();
                            parts.push(...item.blocks.map(one));
                        }
                    }
                    flush();
                    return parts.join("\u0000");
                }
                const kind = block.style === "number" ? `number from ${block.start}` : block.style === "definition" ? "definition" : "bullet";
                return `list ${kind}[${block.items.map((item) => `{${item.checked === undefined ? "" : item.checked ? "x " : "o "}${all(item.blocks)}}`).join("")}]`;
            }
            case "quote":
                return `quote${block.callout ? ` ${block.callout}` : ""}${block.title ? ` ${block.title}` : ""}${block.details ? ` details ${block.details.summary} ${block.details.open}` : ""}(${all(block.blocks)})`;
            case "code":
                return `code ${block.language}(${block.code})`;
            case "table":
                return `table ${JSON.stringify(block.align)} ${[block.header, ...block.rows].map((row) => row.map(seenRuns).join(" | ")).join(" / ")}`;
            case "image":
                return block.align || block.width || block.caption || block.wrap ? `picture(${block.src} ${block.alt} ${block.align ?? ""} ${block.width ?? ""} ${block.caption ?? ""} ${block.wrap ? "wrap" : ""})` : `image(${block.src} ${block.alt} ${block.title ?? ""})`;
            case "divider":
                return "divider";
            case "footnote":
                return `footnote ${block.label}(${all(block.blocks)})`;
            case "raw":
                return `raw(${block.text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "")})`;
        }
    };
    // two definition lists one after the other look like one, and Markdown reads them as one
    const all = (list: Block[]) => {
        const parts: string[] = [];
        for (const part of list.flatMap((block) => one(block).split("\u0000"))) {
            if (part === "") continue;
            const last = parts[parts.length - 1];
            if (last?.startsWith("list definition[") && part.startsWith("list definition[")) parts[parts.length - 1] = last.slice(0, -1) + part.slice("list definition[".length);
            else parts.push(part);
        }
        return parts.join("; ");
    };
    return all(blocks);
}

// ---- what must hold after every change ----

const NEVER = /undefined|NaN|\[object Object\]|\bnull\b/;

/** What is wrong with a model, if anything: an empty container, a block of no known kind, a ragged table, empty text. */
function unsound(blocks: Block[], where = ""): string | undefined {
    for (const [index, block] of blocks.entries()) {
        const here = `${where}/${index} ${block?.kind}`;
        if (!block || !["paragraph", "heading", "list", "quote", "code", "table", "image", "divider", "footnote", "raw"].includes(block.kind)) return `${here}: not a block`;
        if (block.kind === "list") {
            if (block.items.length === 0) return `${here}: a list with no items`;
            for (const item of block.items) {
                if (item.blocks.length === 0) return `${here}: an item with nothing in it`;
                const inner = unsound(item.blocks, here);
                if (inner) return inner;
            }
        }
        if (block.kind === "quote" || block.kind === "footnote") {
            if (block.blocks.length === 0) return `${here}: an empty ${block.kind}`;
            const inner = unsound(block.blocks, here);
            if (inner) return inner;
        }
        if (block.kind === "table" && (block.align.length !== block.header.length || block.rows.some((row) => row.length !== block.header.length))) return `${here}: a ragged table`;
        if ((block.kind === "paragraph" || block.kind === "heading") && block.runs.some((run) => run.kind === "text" && run.text === "")) return `${here}: empty text`;
        if (block.kind === "heading" && block.runs.some((run) => run.kind === "break")) return `${here}: a line break in a heading, which Markdown cannot keep`;
    }
    return undefined;
}

/** What is wrong with a position, if anything: a path to no block or cell, or an offset outside its text or inside a character. */
function badPosition(doc: Document, position: Position): string | undefined {
    const { path, offset } = position ?? {};
    if (!Array.isArray(path)) return `no path at all: ${JSON.stringify(position)}`;
    const block = blockAt(doc, path);
    const leaf = blockPaths(doc).some((each) => each.length === path.length && each.every((step, index) => step === path[index]));
    const cell = tableOf(doc, path);
    if (cell) {
        const found = blockAt(doc, cell);
        const row = path[path.length - 2]!;
        const column = path[path.length - 1]!;
        if (found?.kind !== "table" || row < 0 || row > found.rows.length || column < 0 || column >= found.header.length) return `a cell that is not there at ${JSON.stringify(path)}`;
    } else if (!leaf || !block || block.kind === "table") return `no place to write at ${JSON.stringify(path)}`;
    const length = lengthOf(doc, path);
    if (!Number.isInteger(offset) || offset < 0 || offset > length) return `offset ${offset} outside 0 to ${length} at ${JSON.stringify(path)}`;
    const text = block && (block.kind === "paragraph" || block.kind === "heading") ? runsText(block.runs) : "";
    if (/[\uDC00-\uDFFF]/.test(text[offset] ?? "") && /[\uD800-\uDBFF]/.test(text[offset - 1] ?? "")) return `a position inside a character at ${JSON.stringify(path)} ${offset}`;
    return undefined;
}

/** Everything that must be true of a state after a change, or what is not. */
function check(doc: Document, selection: Selection | undefined): string | undefined {
    const model = unsound(doc.blocks);
    if (model) return `model: ${model}`;
    if (selection) {
        const place = badPosition(doc, selection.anchor) ?? badPosition(doc, selection.focus);
        if (place) return `selection: ${place}`;
    }
    let text: string;
    try {
        text = write(doc);
    } catch (error) {
        return `write threw: ${error}`;
    }
    if (NEVER.test(text)) return `wrote a word from a missing value: ${JSON.stringify(text)}`;
    const back = read(text, { mdx: doc.mdx });
    const want = seen(doc.blocks);
    const got = seen(back.blocks);
    if (want !== got) {
        let at = 0;
        while (at < want.length && want[at] === got[at]) at++;
        return `reads back as something else\n  written: ${JSON.stringify(text)}\n  seen:    ${want.slice(Math.max(0, at - 60), at + 60)}\n  read:    ${got.slice(Math.max(0, at - 60), at + 60)}`;
    }
    return undefined;
}

// ---- random editing ----

const START = [
    "# Title\n\nSome **bold** and *italic* text with a [link](http://x.y) and `code` 😀 é.\n\n- one\n- two\n  - nested **b**\n  - nested two\n- three\n\n1. a\n2. b\n\n- [ ] task\n- [x] done\n\n> quote line\n> second\n\n> [!NOTE]\n> callout text\n\n```js\nlet a = 1;\n```\n\n| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 |\n\n---\n\n![alt](a.png)\n\nLast paragraph ==mark== ||spoil||.\n",
    "Text with a [reference][r] and [short] link.\n\n- a\n-\n- b\n\n3. three\n4. four\n\nTerm\n: its definition\n\n> \n\n[^1]: A note.\n\n<details>\n<summary>More</summary>\n\nHidden.\n\n</details>\n\n[r]: http://r.example\n[short]: /short\n",
    "Plain\nlines\n\n## Heading\n\n* star\n* list\n\n+ plus\n\n1) paren\n2) list\n\n<div>\nraw\n</div>\n\nword(see)more and a_b_c and 2*3*4.\n",
];

const CHARACTERS = ["a", "b", " ", "x", "é", "😀", "👨‍👩‍👧", "*", "_", "#", "-", "1", ".", "`", "~", "=", "|", "^", ":", ">", "<", "[", "]", "(", ")", "!", "\\", "&", "/", "smile", "́", "\t"];
const KEYS: Input[] = [
    { type: "key", key: "Enter" },
    { type: "key", key: "Enter", shift: true },
    { type: "key", key: "Backspace" },
    { type: "key", key: "Backspace" },
    { type: "key", key: "Delete" },
    { type: "key", key: "Tab" },
    { type: "key", key: "Tab", shift: true },
    { type: "key", key: "Backspace", mod: true },
    { type: "key", key: "Delete", mod: true },
    { type: "key", key: "b", mod: true },
    { type: "key", key: "i", mod: true },
    { type: "key", key: "e", mod: true },
    { type: "key", key: "x", mod: true, shift: true },
    { type: "key", key: "1", mod: true, alt: true },
    { type: "key", key: "0", mod: true, alt: true },
    { type: "key", key: "Enter", mod: true },
];
const MARKS: Mark[] = ["bold", "italic", "strike", "code", "underline", "mark", "sup", "sub", "spoiler"];
const KINDS: Kind[] = [{ kind: "paragraph" }, { kind: "heading", level: 2 }, { kind: "list", style: "bullet" }, { kind: "list", style: "number" }, { kind: "list", style: "task" }, { kind: "quote" }, { kind: "code" }];

/**
 * Every place the trials put the cursor: the paths of the blocks that hold text, and each cell of
 * each table. Not raw blocks: their text is kept exactly as typed, and what it then means (HTML, a
 * definition, a paragraph) is the reader's to say, which is not the writer's to keep.
 */
function places(doc: Document): number[][] {
    const all = blockPaths(doc).flatMap((path) => {
        const block = blockAt(doc, path);
        if (block?.kind === "raw") return [];
        if (block?.kind !== "table") return [path];
        const cells: number[][] = [];
        for (let row = 0; row <= block.rows.length; row++) for (let column = 0; column < block.header.length; column++) cells.push([...path, row, column]);
        return cells;
    });
    return all.length ? all : blockPaths(doc);
}

function somewhere(doc: Document, random: ReturnType<typeof generator>): Position {
    const path = random.pick(places(doc));
    const length = lengthOf(doc, path);
    let offset = random.next() < 0.25 ? length : Math.floor(random.next() * (length + 1));
    const block = blockAt(doc, path);
    const text = block && (block.kind === "paragraph" || block.kind === "heading") ? runsText(block.runs) : "";
    if (/[\uDC00-\uDFFF]/.test(text[offset] ?? "") && /[\uD800-\uDBFF]/.test(text[offset - 1] ?? "")) offset--;
    return { path, offset };
}

/** One random change to an editor, and a word for it. Changes made through keys.ts must leave a good selection; the rest are made to the document alone, as a menu does, and the selection is put somewhere afresh. */
function change(editor: Editor, random: ReturnType<typeof generator>, time: number): { editor: Editor; what: string; keyed: boolean } {
    const roll = random.next();
    const { doc } = editor.state;
    // keys can bring the cursor into a raw block, whose text is not the writer's to keep (see places)
    const raw = (position: Position) => blockAt(doc, position.path)?.kind === "raw";
    if (raw(editor.state.selection.anchor) || raw(editor.state.selection.focus)) {
        const place = somewhere(doc, random);
        return { editor: { ...editor, state: { doc, selection: { anchor: place, focus: place } } }, what: `select ${JSON.stringify(place)}`, keyed: true };
    }
    const own = (next: Document, what: string) => {
        const state = { doc: next, selection: caret(places(next)[0]!, 0) };
        return { editor: { state, history: record(editor.history, editor.state, state, "structure", time) }, what, keyed: false };
    };
    if (roll < 0.12) {
        const anchor = somewhere(doc, random);
        const focus = random.next() < 0.5 ? anchor : somewhere(doc, random);
        return { editor: { ...editor, state: { doc, selection: { anchor, focus } } }, what: `select ${JSON.stringify([anchor, focus])}`, keyed: true };
    }
    if (roll < 0.5) {
        const text = random.pick(CHARACTERS) + (random.next() < 0.2 ? random.pick(CHARACTERS) : "");
        return { editor: step(editor, { type: "text", text }, time, { symbols: true }).editor, what: `type ${JSON.stringify(text)}`, keyed: true };
    }
    if (roll < 0.75) {
        const key = random.pick(KEYS);
        return { editor: step(editor, key, time, { symbols: true }).editor, what: `key ${JSON.stringify(key)}`, keyed: true };
    }
    if (roll < 0.83) {
        const taken = fragment(doc, { anchor: somewhere(doc, random), focus: somewhere(doc, random) });
        const state = paste(editor.state, taken);
        return { editor: { state, history: record(editor.history, editor.state, state, "paste", time) }, what: `paste ${taken.map((block) => block.kind).join(",")}`, keyed: true };
    }
    if (roll < 0.9) {
        const range = { start: somewhere(doc, random), end: somewhere(doc, random) };
        const mark = random.pick(MARKS);
        const state = { doc: toggleMark(doc, range, mark), selection: editor.state.selection };
        return { editor: { state, history: record(editor.history, editor.state, state, "format", time) }, what: `mark ${mark} ${JSON.stringify(range)}`, keyed: true };
    }
    if (roll < 0.93) {
        const range = { start: somewhere(doc, random), end: somewhere(doc, random) };
        if (random.next() < 0.5) return own(setLink(doc, range, random.pick(["http://x.y/(a)", "/a b", "<x>", "http://x.y/a_b*c"])), `link ${JSON.stringify(range)}`);
        return own(setStyle(doc, range, { color: random.pick(["red", "#336699"]) }), `colour ${JSON.stringify(range)}`);
    }
    if (roll < 0.95) {
        // the commands from Docs' menus, each at a random place
        const anchor = somewhere(doc, random);
        const focus = random.next() < 0.3 ? anchor : somewhere(doc, random);
        const commands: [string, Action][] = [
            ["lowercase", recase("lower")],
            ["UPPERCASE", recase("upper")],
            ["Title Case", recase("title")],
            ["bullets with *", markWith("*")],
            ["bullets with +", markWith("+")],
            ["restart at 1", restartAt(1)],
            ["restart at 7", restartAt(7)],
            ["continue the list before", continuePrevious],
        ];
        const [what, command] = random.pick(commands);
        const state = command({ doc, selection: { anchor, focus } });
        return { editor: { state, history: record(editor.history, editor.state, state, "format", time) }, what: `${what} ${JSON.stringify([anchor, focus])}`, keyed: true };
    }
    if (roll < 0.97) {
        const path = random.pick(blockPaths(doc));
        const kind = random.pick(KINDS);
        return own(changeKind(doc, path, kind), `change ${JSON.stringify(path)} to ${JSON.stringify(kind)}`);
    }
    const path = random.pick(blockPaths(doc));
    if (random.next() < 0.5) return own(removeBlock(doc, path), `remove ${JSON.stringify(path)}`);
    const block = random.pick<Block>([table(["a", "b|c"], [["1", "`x`"]]), list("bullet", ["new"]), list("number", ["", "two"]), { kind: "divider", gap: "" }, { kind: "quote", blocks: [{ kind: "paragraph", runs: [], gap: "" }], gap: "" }]);
    return own(insertBlock(doc, path, block), `insert ${block.kind} after ${JSON.stringify(path)}`);
}

test("any run of edits writes Markdown that reads back as what the writer sees, with the selection always somewhere real", () => {
    const random = generator(SEED);
    const runs = 1000 * TIMES;
    const failures: string[] = [];
    for (let run = 0; run < runs && failures.length < ENOUGH; run++) {
        const start = START[run % START.length]!;
        const mdx = run % 7 === 6;
        let editor: Editor = { state: { doc: read(start, { mdx }), selection: caret([0], 0) }, history: createHistory() };
        const done: string[] = [];
        for (let count = 0; count < 15; count++) {
            let made: ReturnType<typeof change>;
            try {
                made = change(editor, random, count * 10);
            } catch (error) {
                failures.push(`run ${run} threw on its change ${count}: ${String(error)}\n  after: ${done.slice(-4).join("; ")}`);
                break;
            }
            done.push(made.what);
            editor = made.editor;
            const wrong = check(editor.state.doc, made.keyed ? editor.state.selection : undefined);
            if (wrong) {
                failures.push(`run ${run}, ${wrong}\n  after: ${done.slice(-5).join("\n         ")}`);
                break;
            }
        }
    }
    if (failures.length) console.log(`${failures.length} of ${runs} runs of edits failed`);
    expect(failures.slice(0, 5)).toEqual([]);
}, 60000 * TIMES);

// ---- random marked text ----

const PIECES = ["*", "_", "~", "`", "|", "=", "^", "$", ":", "[", "]", "(", ")", "<", ">", "&", "\\", "#", "-", "!", "+", "1", ".", "a", "b", "c", " ", "x y", "smile", "http://x.y", "@", "{", "}", " ", "é", "😀", "(see)"];

test("marked text next to any punctuation reads back with the same marks, in a paragraph, a heading, a list, a quote and a table cell", () => {
    const random = generator(SEED + 7);
    const cases = 4000 * TIMES;
    const failures: string[] = [];
    for (let index = 0; index < cases && failures.length < ENOUGH; index++) {
        const where = random.pick(["paragraph", "heading", "item", "quote", "cell"]);
        const runs: Run[] = [];
        const count = 1 + Math.floor(random.next() * 4);
        for (let part = 0; part < count; part++) {
            let text = "";
            for (let length = 1 + Math.floor(random.next() * 3); length > 0; length--) text += random.pick(PIECES);
            const marks = new Set<Mark>();
            if (random.next() < 0.6) marks.add(random.pick(MARKS));
            if (random.next() < 0.2) marks.add(random.pick(MARKS));
            // a table cell's pipes are its edges, so a spoiler cannot be kept in one (write.ts)
            if (where === "cell") marks.delete("spoiler");
            const leaf: Run = { kind: "text", text, marks: [...marks] };
            if (random.next() < 0.1) runs.push({ kind: "link", href: "http://x.y", runs: [leaf] });
            else if (random.next() < 0.05) runs.push({ kind: "emoji", name: "smile" });
            else runs.push(leaf);
        }
        const paragraph: Block = { kind: "paragraph", runs, gap: "" };
        const block: Block =
            where === "paragraph"
                ? paragraph
                : where === "heading"
                  ? { kind: "heading", level: 2, runs, gap: "" }
                  : where === "item"
                    ? { ...list("bullet", []), items: [{ blocks: [paragraph], gap: "" }] }
                    : where === "quote"
                      ? { kind: "quote", blocks: [paragraph], gap: "" }
                      : { kind: "table", header: [[{ kind: "text", text: "h", marks: [] }]], align: [null], rows: [[runs]], gap: "" };
        const doc: Document = { bom: "", frontmatter: null, lead: "", blocks: [{ ...block, gap: "\n" }], eol: "\n", mdx: false };
        // a line that starts with a link whose words begin with code holding `]:` is a link reference
        // definition to CommonMark, and nothing written inside code can change that: left out
        if (/^(- |> )?\[`[^`]*\]:/.test(write(doc))) continue;
        // and a spoiler that opens straight on the end of a bare web address: there `||` is part of the address (read.ts)
        if (/:\/\/[^\s<>"'`\]]*\|\|/.test(write(doc))) continue;
        const wrong = check(doc, undefined);
        if (wrong) failures.push(`${where} ${JSON.stringify(runs)}: ${wrong}`);
    }
    if (failures.length) console.log(`${failures.length} of ${cases} marked lines failed`);
    expect(failures.slice(0, 5)).toEqual([]);
}, 60000 * TIMES);
