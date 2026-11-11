// The editor page that `bun run edit` opens.
//
// A file is edited as what it is: its Markdown, frontmatter and all, in one
// plain text area, with the real page beside it. Rich text is a switch for
// when formatted text is nicer to write in. Either way it saves as you type.
// Reading and writing Markdown is in markdown.ts; the server is ../write.ts.

import { guard, joinFile, parseBody, parseInline, splitFile, tableMarkdown, toHtml, toMarkdown, type Block, type Inline } from "./markdown";

interface FileEntry {
    path: string;
    label: string;
    draft: boolean;
    route: string;
}
interface Group {
    label: string;
    files: FileEntry[];
}

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";
const key = meta("edit-key");
const site = meta("edit-site");
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: object = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
}

async function api<T>(path: string, body?: unknown, raw?: Blob): Promise<T> {
    const response = await fetch(path, {
        method: body === undefined && !raw ? "GET" : "POST",
        headers: { "x-edit-key": key, ...(raw ? {} : { "content-type": "application/json" }) },
        body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const data = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(data.error ?? response.statusText);
    return data;
}

/** Small choices remembered between visits. */
const memory = {
    get(name: string): string | null {
        try {
            return localStorage.getItem(`edit-${name}`);
        } catch {
            return null;
        }
    },
    set(name: string, value: string): void {
        try {
            localStorage.setItem(`edit-${name}`, value);
        } catch {
            // private windows may refuse; carry on without
        }
    },
};

const list = $("list");
const write = $("write");
const text = $<HTMLTextAreaElement>("text");
const richBox = $("rich");
const frontText = $<HTMLTextAreaElement>("front");
const body = $("body");
const status = $("status");
const frame = $<HTMLIFrameElement>("preview");

let file: { path: string; hash: string; content: string; markdown: boolean; route: string } | undefined;
let rich = memory.get("rich") === "1";
let files: FileEntry[] = [];
/** What each block on the page came from, and what it looked like then. */
const known = new WeakMap<Element, { block: Block; was: string }>();

const richNow = () => rich && Boolean(file?.markdown);

// ---- showing a file ----

/** Make a text area as tall as what is in it, without the page jumping. */
function grow(area: HTMLTextAreaElement): void {
    const top = write.scrollTop;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight + 2}px`;
    write.scrollTop = top;
}

function growAll(): void {
    for (const area of write.querySelectorAll("textarea")) if (area.offsetParent) grow(area);
}

/** A block the rich view shows as itself: code, a picture, or source it leaves alone. */
function island(kind: "code" | "raw" | "image", block: Partial<Block>): HTMLElement {
    const box = el("div", { className: `island ${kind}`, contentEditable: "false" });
    if (kind === "image") {
        const url = block.url ?? "";
        const shown = /^https?:/.test(url) ? url : `/api/asset?file=${encodeURIComponent(file?.path ?? "")}&src=${encodeURIComponent(url)}&k=${key}`;
        box.dataset.url = url;
        box.append(el("img", { src: shown, alt: "" }), el("input", { value: block.alt ?? "", placeholder: "describe the picture" }));
        return box;
    }
    if (kind === "code") box.append(el("input", { value: block.lang ?? "", placeholder: "language", className: "lang" }));
    const area = el("textarea", { value: kind === "code" ? (block.code ?? "") : (block.src ?? ""), spellcheck: false, rows: 1 });
    box.append(area);
    queueMicrotask(() => grow(area));
    return box;
}

function show(block: Block): Element {
    const inline = (source: string) => toHtml(parseInline(source)) || "<br>";
    switch (block.type) {
        case "heading":
            return el(`h${block.level!}` as "h2", { innerHTML: inline(block.text!) });
        case "paragraph":
            return el("p", { innerHTML: inline(block.text!) });
        case "list":
            return el(block.ordered ? "ol" : "ul", { innerHTML: block.items!.map((item) => `<li>${inline(item)}</li>`).join("") });
        case "quote":
            return el("blockquote", { innerHTML: block.paragraphs!.map((paragraph) => `<p>${inline(paragraph)}</p>`).join("") });
        case "table": {
            const row = (cells: string[], tag: string) => `<tr>${cells.map((cell) => `<${tag}>${inline(cell)}</${tag}>`).join("")}</tr>`;
            const table = el("table", { innerHTML: `<thead>${row(block.head!, "th")}</thead><tbody>${block.rows!.map((cells) => row(cells, "td")).join("")}</tbody>` });
            table.dataset.align = block.align!.join(" ");
            return table;
        }
        case "rule":
            return el("hr");
        case "code":
        case "image":
        case "raw":
            return island(block.type, block);
    }
}

/** What a block looks like now, to tell whether it has been touched. */
function look(node: Element): string {
    if (!node.classList.contains("island")) return node.outerHTML;
    return JSON.stringify([...node.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map((field) => field.value));
}

const emptyLine = () => el("p", { innerHTML: "<br>" });

/** Put the open file on the page, in whichever of the two views is chosen. */
function render(): void {
    notesBox.hidden = true;
    if (!file) return;
    const formatted = richNow();
    text.hidden = formatted;
    richBox.hidden = !formatted;
    $("mode").hidden = !file.markdown;
    $("tools").hidden = !file.markdown;
    $("mode-markdown").setAttribute("aria-pressed", String(!formatted));
    $("mode-rich").setAttribute("aria-pressed", String(formatted));
    if (!formatted) {
        text.value = file.content;
        grow(text);
        return;
    }
    const parts = splitFile(file.content);
    frontText.hidden = parts.front === null;
    frontText.value = parts.front?.join("\n") ?? "";
    grow(frontText);
    const { lead, blocks } = parseBody(parts.body);
    body.dataset.lead = lead;
    body.replaceChildren();
    for (const block of blocks) {
        const node = show(block);
        body.append(node);
        known.set(node, { block, was: look(node) });
    }
    body.append(emptyLine());
}

async function open(path: string): Promise<void> {
    await save();
    if (path === PHOTOS) return openNotes();
    const loaded = await api<{ content: string; hash: string }>(`/api/file?path=${encodeURIComponent(path)}`);
    const route = files.find((entry) => entry.path === path)?.route ?? "/";
    file = { path, hash: loaded.hash, content: loaded.content, markdown: /\.mdx?$/.test(path), route };
    render();
    point(path, route);
}

/** Mark what is open in the list and show its page in the preview. */
function point(path: string, route: string): void {
    for (const link of list.querySelectorAll("button")) link.classList.toggle("here", link.dataset.path === path);
    if (frame.dataset.route !== route) {
        frame.dataset.route = route;
        frame.src = site + route;
    }
    $<HTMLAnchorElement>("view").href = site + route;
    memory.set("last", path);
    say("");
    write.scrollTop = 0;
}

async function showList(): Promise<void> {
    const groups = await api<Group[]>("/api/files");
    files = groups.flatMap((group) => group.files);
    list.replaceChildren();
    for (const group of groups) {
        list.append(el("h2", {}, group.label));
        for (const entry of group.files) {
            const link = el("button", { type: "button", className: entry.path === file?.path ? "here" : "" }, entry.label);
            if (entry.draft) link.append(el("small", {}, "draft"));
            link.dataset.path = entry.path;
            link.addEventListener("click", () => void open(entry.path).catch(fail));
            list.append(link);
        }
    }
}

// ---- reading the rich view back into Markdown ----

function inlineOf(node: Node): Inline[] {
    const out: Inline[] = [];
    node.childNodes.forEach((child, index) => {
        if (child instanceof Text) out.push({ t: "text", v: child.data.replace(/\s+/g, " ") });
        if (!(child instanceof HTMLElement)) return;
        const tag = child.tagName;
        if (tag === "BR") {
            if (index < node.childNodes.length - 1) out.push({ t: "text", v: " " });
        } else if (tag === "B" || tag === "STRONG") out.push({ t: "strong", c: inlineOf(child) });
        else if (tag === "I" || tag === "EM") out.push({ t: "em", c: inlineOf(child) });
        else if (tag === "S" || tag === "DEL" || tag === "STRIKE") out.push({ t: "del", c: inlineOf(child) });
        else if (tag === "CODE") out.push({ t: "code", v: child.textContent ?? "" });
        else if (tag === "A") out.push({ t: "link", href: child.getAttribute("href") ?? "", c: inlineOf(child) });
        else if (tag !== "UL" && tag !== "OL") out.push(...inlineOf(child));
    });
    return out;
}

/** Tidy what a browser leaves behind: empty marks, and spaces inside the ends of a mark. */
function tidy(nodes: Inline[]): Inline[] {
    const out: Inline[] = [];
    const add = (v: string) => {
        const last = out[out.length - 1];
        if (!v) return;
        if (last?.t === "text") last.v += v;
        else out.push({ t: "text", v });
    };
    for (const node of nodes) {
        if (node.t === "text") add(node.v);
        else if (node.t === "code") node.v && out.push(node);
        else {
            const inner = tidy(node.c);
            const first = inner[0];
            const last = inner[inner.length - 1];
            let before = "";
            let after = "";
            if (first?.t === "text") [before, first.v] = [/^\s*/.exec(first.v)![0], first.v.trimStart()];
            if (last?.t === "text") [after, last.v] = [/\s*$/.exec(last.v)![0], last.v.trimEnd()];
            const kept = inner.filter((part) => part.t !== "text" || part.v);
            add(before);
            if (kept.length > 0) out.push({ ...node, c: kept });
            add(after);
        }
    }
    return out;
}

function lineOf(node: Node): string {
    const nodes = tidy(inlineOf(node));
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (first?.t === "text") first.v = first.v.trimStart();
    if (last?.t === "text") last.v = last.v.trimEnd();
    return toMarkdown(nodes.filter((part) => part.t !== "text" || part.v));
}

function listOf(node: Element, indent: string): string {
    const ordered = node.tagName === "OL";
    const lines: string[] = [];
    [...node.children].forEach((item, index) => {
        const marker = ordered ? `${index + 1}.` : "-";
        lines.push(`${indent}${marker} ${lineOf(item)}`);
        for (const nested of item.querySelectorAll(":scope > ul, :scope > ol")) lines.push(listOf(nested, indent + " ".repeat(marker.length + 1)));
    });
    return lines.join("\n");
}

function blockOf(node: Element): string {
    if (node.classList.contains("island")) {
        const area = node.querySelector("textarea")?.value ?? "";
        const input = node.querySelector("input")?.value ?? "";
        if (node.classList.contains("code")) return `\`\`\`${input}\n${area}\n\`\`\``;
        if (node.classList.contains("image")) return `![${input.replace(/[[\]]/g, "")}](${(node as HTMLElement).dataset.url})`;
        return area.replace(/\s+$/, "");
    }
    const tag = node.tagName;
    if (tag === "HR") return "---";
    if (tag === "UL" || tag === "OL") return listOf(node, "");
    if (tag === "TABLE") {
        const rows = [...node.querySelectorAll("tr")].map((row) => [...row.children].map((cell) => lineOf(cell).replace(/\|/g, "\\|")));
        const [head, ...rest] = rows;
        return head ? tableMarkdown(head, ((node as HTMLElement).dataset.align ?? "").split(" "), rest) : "";
    }
    if (/^H[1-6]$/.test(tag)) {
        const line = lineOf(node);
        return line ? `${"#".repeat(Number(tag[1]))} ${line}` : "";
    }
    if (tag === "BLOCKQUOTE") {
        const parts = [...node.children].some((child) => /^(P|DIV|UL|OL|H[1-6]|BLOCKQUOTE)$/.test(child.tagName))
            ? [...node.children].map(blockOf).filter(Boolean)
            : [lineOf(node)].filter(Boolean);
        if (parts.length === 0) return "";
        return parts.join("\n\n").split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
    }
    return guard(lineOf(node));
}

const BLOCK = /^(P|DIV|UL|OL|BLOCKQUOTE|H[1-6]|HR|PRE|TABLE)$/;

/**
 * Browsers sometimes put a list or a quote inside the paragraph it was made
 * from. Lift such things out, so every block sits directly on the page.
 */
function flatten(): void {
    const selection = getSelection();
    const cursor = selection?.rangeCount ? { node: selection.anchorNode, offset: selection.anchorOffset } : undefined;
    let moved = false;
    for (const node of [...body.children]) {
        if (!/^(P|DIV)$/.test(node.tagName) || node.classList.contains("island")) continue;
        if (![...node.children].some((child) => BLOCK.test(child.tagName))) continue;
        const pieces: Element[] = [];
        let run: HTMLElement | undefined;
        for (const child of [...node.childNodes]) {
            if (child instanceof Element && BLOCK.test(child.tagName)) {
                run = undefined;
                pieces.push(child);
            } else {
                if (!run) pieces.push((run = el("p")));
                run.append(child);
            }
        }
        node.replaceWith(...pieces.filter((piece) => piece.tagName !== "P" || piece.textContent?.trim() || piece.querySelector("br")));
        moved = true;
    }
    if (moved && cursor?.node && body.contains(cursor.node)) selection?.collapse(cursor.node, cursor.offset);
}

/** The rich view as Markdown. A block nobody touched comes back exactly as the file had it. */
function read(): string {
    flatten();
    const parts: { text: string; gap: string }[] = [];
    for (const node of body.childNodes) {
        if (node instanceof Text) {
            if (node.data.trim()) parts.push({ text: guard(toMarkdown([{ t: "text", v: node.data.trim() }])), gap: "\n\n" });
            continue;
        }
        if (!(node instanceof Element)) continue;
        const origin = known.get(node);
        if (origin && origin.was === look(node)) parts.push({ text: origin.block.src, gap: origin.block.gap });
        else {
            const markdown = blockOf(node);
            if (markdown) parts.push({ text: markdown, gap: "\n\n" });
        }
    }
    const written = parts.map((part, index) => part.text + (index === parts.length - 1 ? "\n" : part.gap.length > 1 ? part.gap : "\n\n")).join("");
    return (body.dataset.lead ?? "") + written;
}

/** The file as it stands on the page right now. */
function contentNow(): string {
    if (!richNow()) return text.value;
    return joinFile(frontText.hidden ? null : frontText.value.split("\n"), read());
}

// ---- saving ----

let timer = 0;
let dirty = false;
let saving: Promise<void> = Promise.resolve();

function say(message: string, bad = false): void {
    status.textContent = message;
    status.classList.toggle("bad", bad);
}
const fail = (error: unknown) => say(error instanceof Error ? error.message : String(error), true);

function changed(): void {
    dirty = true;
    say("not saved yet");
    clearTimeout(timer);
    timer = window.setTimeout(() => void save(), 600);
}

function save(): Promise<void> {
    clearTimeout(timer);
    saving = saving.then(async () => {
        if (!dirty || !file) return;
        dirty = false;
        const open = file;
        open.content = contentNow();
        try {
            const result = await api<{ hash: string }>("/api/save", { path: open.path, content: open.content, hash: open.hash });
            open.hash = result.hash;
            if (!dirty) say("saved");
        } catch (error) {
            dirty = true;
            fail(error);
        }
    });
    return saving;
}

// ---- tools for Markdown ----

// execCommand is marked as deprecated, but nothing has replaced it for
// editing text in a way that keeps undo working, and every browser still does it.
const editing = document as unknown as { execCommand(name: string, ui: boolean, value?: string): boolean };
const command = (name: string, value?: string) => editing.execCommand(name, false, value);

const type = (inserted: string) => {
    text.focus();
    command("insertText", inserted);
};

/** Put marks around the selection, or around a placeholder if nothing is selected. */
function wrap(before: string, after = before, placeholder = "text"): void {
    const start = text.selectionStart;
    const chosen = text.value.slice(start, text.selectionEnd) || placeholder;
    type(before + chosen + after);
    text.setSelectionRange(start + before.length, start + before.length + chosen.length);
}

/** Change the start of every selected line. */
function lines(change: (line: string, index: number) => string): void {
    const start = text.value.lastIndexOf("\n", text.selectionStart - 1) + 1;
    const found = text.value.indexOf("\n", text.selectionEnd);
    const end = found < 0 ? text.value.length : found;
    text.setSelectionRange(start, end);
    type(text.value.slice(start, end).split("\n").map(change).join("\n"));
}

/** Something that stands on its own lines, with a blank line either side. */
function standalone(markdown: string, cursor = markdown.length): void {
    const before = text.value.slice(0, text.selectionStart);
    const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const start = text.selectionStart + lead.length;
    type(`${lead}${markdown}\n`);
    text.setSelectionRange(start + cursor, start + cursor);
}

const heading = (marks: string) => lines((line) => (line.startsWith(`${marks} `) ? line.slice(marks.length + 1) : `${marks} ${line.replace(/^#+\s*/, "")}`));

const markdownTools: Record<string, () => void> = {
    bold: () => wrap("**"),
    italic: () => wrap("*"),
    strike: () => wrap("~~"),
    code: () => wrap("`", "`", "code"),
    link() {
        const start = text.selectionStart;
        const chosen = text.value.slice(start, text.selectionEnd) || "text";
        type(`[${chosen}](https://)`);
        text.setSelectionRange(start + chosen.length + 3, start + chosen.length + 11);
    },
    h2: () => heading("##"),
    h3: () => heading("###"),
    ul: () => lines((line) => `- ${line}`),
    ol: () => lines((line, index) => `${index + 1}. ${line}`),
    quote: () => lines((line) => `> ${line}`),
    rule: () => standalone("---"),
    codeblock: () => standalone("```\n\n```", 4),
    image: () => $<HTMLInputElement>("picture").click(),
};

text.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    const shortcut = modifier && { b: "bold", i: "italic", k: "link" }[event.key];
    if (shortcut) {
        event.preventDefault();
        markdownTools[shortcut]?.();
    } else if (event.key === "Tab") {
        event.preventDefault();
        if (text.selectionStart === text.selectionEnd && !event.shiftKey) type("    ");
        else lines((line) => (event.shiftKey ? line.replace(/^( {1,4}|\t)/, "") : `    ${line}`));
    } else if (event.key === "Enter" && !modifier && !event.shiftKey && text.selectionStart === text.selectionEnd) {
        // Carry a list or a quote on to the next line; an empty item ends it.
        const start = text.value.lastIndexOf("\n", text.selectionStart - 1) + 1;
        const line = text.value.slice(start, text.selectionStart);
        const item = /^(\s*)(?:([-*+>])|(\d+)([.)]))(\s+)(.*)$/.exec(line);
        if (!item) return;
        event.preventDefault();
        const [, indent = "", bullet, number, dot = "", space = " ", rest = ""] = item;
        if (rest.trim() === "") {
            text.setSelectionRange(start, text.selectionStart);
            command("delete");
        } else type(`\n${indent}${bullet ?? `${Number(number) + 1}${dot}`}${space}`);
    }
});

text.addEventListener("input", () => {
    grow(text);
    changed();
});

// ---- tools for rich text ----

/** The top-level block the cursor is in. */
function here(): Element | undefined {
    let node: Node | null | undefined = getSelection()?.anchorNode;
    while (node && node.parentNode !== body) node = node.parentNode;
    return node instanceof Element ? node : undefined;
}

function place(node: Element): void {
    const at = here() ?? body.lastElementChild;
    if (at) at.after(node);
    else body.append(node);
    if (!node.nextElementSibling) body.append(emptyLine());
    changed();
}

function inside(tag: string): HTMLElement | null {
    const node = getSelection()?.anchorNode;
    const start = node instanceof Element ? node : node?.parentElement;
    const found = start?.closest<HTMLElement>(tag) ?? null;
    return found && body.contains(found) ? found : null;
}

let linkRange: Range | undefined;

const richTools: Record<string, () => void> = {
    bold: () => command("bold"),
    italic: () => command("italic"),
    strike: () => command("strikeThrough"),
    code() {
        const selection = getSelection();
        const existing = inside("code");
        if (existing) existing.replaceWith(...existing.childNodes);
        else if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const code = el("code", {}, range.toString());
            range.deleteContents();
            range.insertNode(code);
            selection.selectAllChildren(code);
        }
    },
    link() {
        const selection = getSelection();
        if (!selection || selection.rangeCount === 0) return;
        linkRange = selection.getRangeAt(0).cloneRange();
        const box = $<HTMLInputElement>("link");
        box.value = inside("a")?.getAttribute("href") ?? "";
        box.hidden = false;
        box.focus();
    },
    h2: () => command("formatBlock", inside("h2") ? "p" : "h2"),
    h3: () => command("formatBlock", inside("h3") ? "p" : "h3"),
    quote() {
        const quote = inside("blockquote");
        if (quote) quote.replaceWith(...quote.childNodes);
        else command("formatBlock", "blockquote");
    },
    ul: () => command("insertUnorderedList"),
    ol: () => command("insertOrderedList"),
    rule: () => place(el("hr")),
    codeblock() {
        const box = island("code", { code: "", lang: "" });
        place(box);
        box.querySelector("textarea")?.focus();
    },
    image: () => $<HTMLInputElement>("picture").click(),
};

$("tools").addEventListener("mousedown", (event) => {
    // keep the selection where it is while a button is pressed
    if ((event.target as Element).closest("button")) event.preventDefault();
});
$("tools").addEventListener("click", (event) => {
    const name = (event.target as Element).closest<HTMLElement>("button[data-tool]")?.dataset.tool;
    if (!name) return;
    if (richNow()) {
        richTools[name]?.();
        flatten();
        changed();
    } else markdownTools[name]?.();
});

$<HTMLInputElement>("link").addEventListener("keydown", (event) => {
    const box = event.target as HTMLInputElement;
    if (event.key !== "Enter" && event.key !== "Escape") return;
    event.preventDefault();
    box.hidden = true;
    const selection = getSelection();
    if (linkRange && selection) {
        selection.removeAllRanges();
        selection.addRange(linkRange);
    }
    if (event.key === "Enter") {
        if (box.value.trim()) command("createLink", box.value.trim());
        else command("unlink");
        changed();
    }
});

$<HTMLInputElement>("picture").addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0];
    input.value = "";
    if (!picked || !file) return;
    try {
        const { url } = await api<{ url: string }>(`/api/upload?file=${encodeURIComponent(file.path)}&name=${encodeURIComponent(picked.name)}`, undefined, picked);
        if (richNow()) place(island("image", { url, alt: "" }));
        else standalone(`![](${url})`, 2);
    } catch (error) {
        fail(error);
    }
});

command("defaultParagraphSeparator", "p");

/** Markdown shorthand typed at the start of a line in the rich view. */
const SHORTHAND: Record<string, string> = { "##": "h2", "###": "h3", "-": "ul", "*": "ul", "1.": "ol", ">": "quote", "```": "codeblock", "---": "rule" };

body.addEventListener("input", (event) => {
    const block = here();
    if ((event as InputEvent).data === " " && block?.tagName === "P") {
        const typed = (block.textContent ?? "").replace(/\s+$/, "");
        const tool = SHORTHAND[typed];
        if (tool && (block.textContent ?? "").length === typed.length + 1) {
            block.innerHTML = "<br>";
            getSelection()?.collapse(block, 0);
            richTools[tool]?.();
        }
    }
    flatten();
    if (event.target instanceof HTMLTextAreaElement) grow(event.target);
    if (!body.lastElementChild || !/^(P|H[1-6])$/.test(body.lastElementChild.tagName)) body.append(emptyLine());
    changed();
});

body.addEventListener("paste", (event) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    command("insertText", event.clipboardData?.getData("text/plain") ?? "");
});

body.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        // Backspace in an emptied code, picture or source block takes the block away.
        const box = target.closest(".island");
        const empty = [...(box?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea") ?? [])].every((field) => !field.value);
        if (event.key === "Backspace" && box && empty) {
            event.preventDefault();
            box.remove();
            changed();
        }
        return;
    }
    const cell = inside("td") ?? inside("th");
    if (cell && (event.key === "Enter" || event.key === "Tab")) {
        // In a table, Tab and Enter move between cells; past the last one, a new row begins.
        event.preventDefault();
        const table = cell.closest("table")!;
        const all = [...table.querySelectorAll<HTMLElement>("th, td")];
        let next = all[all.indexOf(cell) + (event.shiftKey ? -1 : 1)];
        if (!next && !event.shiftKey) {
            const row = el("tr", { innerHTML: "<td><br></td>".repeat(cell.parentElement!.children.length) });
            (table.tBodies[0] ?? table).append(row);
            next = row.firstElementChild as HTMLElement;
            changed();
        }
        if (next) getSelection()?.selectAllChildren(next);
    } else if (event.key === "Tab" && inside("li")) {
        event.preventDefault();
        command(event.shiftKey ? "outdent" : "indent");
    }
});

frontText.addEventListener("input", () => {
    grow(frontText);
    changed();
});

// ---- notes on photographs ----
//
// One picture at a time, with its heading and a box for rough notes. The notes
// are kept beside the picture and never shown on the site; its caption is
// written from them later.

interface PhotoNote {
    file: string;
    title?: string;
    note?: string;
    kind?: string;
    taken?: string;
}

const PHOTOS = "src/data/photos.json";
const notesBox = $("notes");
const noteImage = $<HTMLImageElement>("note-image");
const noteTitle = $<HTMLInputElement>("note-title");
const noteText = $<HTMLTextAreaElement>("note-text");
let notes: PhotoNote[] = [];
let noteAt = 0;
let noteTimer = 0;

function showNote(): void {
    const photo = notes[noteAt];
    if (!photo) return;
    noteImage.src = `/api/asset?file=${PHOTOS}&src=/photos/${photo.file}&k=${key}`;
    noteTitle.value = photo.title ?? "";
    noteText.value = photo.note ?? "";
    grow(noteText);
    const done = notes.filter((entry) => entry.note).length;
    $("note-count").textContent = `${noteAt + 1} of ${notes.length}${photo.kind ? " · shitpost" : ""}${photo.taken ? ` · ${photo.taken}` : ""} · ${done} with notes`;
    memory.set("note-at", photo.file);
}

function saveNote(): Promise<void> {
    clearTimeout(noteTimer);
    const photo = notes[noteAt];
    if (!photo || (photo.title ?? "") + "\n" + (photo.note ?? "") === noteTitle.value + "\n" + noteText.value) return Promise.resolve();
    photo.title = noteTitle.value;
    photo.note = noteText.value;
    return api("/api/photos/note", { file: photo.file, title: photo.title, note: photo.note }).then(() => say("saved"), fail);
}

function noteChanged(): void {
    say("not saved yet");
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => void saveNote(), 600);
}

async function stepNote(by: number): Promise<void> {
    await saveNote();
    noteAt = (noteAt + by + notes.length) % notes.length;
    showNote();
    noteText.focus();
}

async function openNotes(): Promise<void> {
    file = undefined;
    text.hidden = richBox.hidden = $("mode").hidden = $("tools").hidden = true;
    notesBox.hidden = false;
    notes = (await api<{ photos: PhotoNote[] }>("/api/photos")).photos;
    noteAt = Math.max(0, notes.findIndex((photo) => photo.file === memory.get("note-at")));
    showNote();
    point(PHOTOS, "/photos/");
}

noteTitle.addEventListener("input", noteChanged);
noteText.addEventListener("input", () => {
    grow(noteText);
    noteChanged();
});
$("note-back").addEventListener("click", () => void stepNote(-1));
$("note-next").addEventListener("click", () => void stepNote(1));
// Ctrl+Enter in the notes moves on to the next picture.
notesBox.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void stepNote(1);
    }
});

// ---- switching views ----

async function setRich(on: boolean): Promise<void> {
    if (on === rich) return;
    await save();
    rich = on;
    memory.set("rich", on ? "1" : "0");
    render();
}
$("mode-markdown").addEventListener("click", () => void setRich(false));
$("mode-rich").addEventListener("click", () => void setRich(true));

function setPreview(on: boolean): void {
    document.body.classList.toggle("no-preview", !on);
    $("toggle-preview").setAttribute("aria-pressed", String(on));
    memory.set("preview", on ? "1" : "0");
    growAll();
}
$("toggle-preview").addEventListener("click", () => setPreview(document.body.classList.contains("no-preview")));
setPreview(memory.get("preview") !== "0");

document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        dirty = dirty || Boolean(file);
        void save();
    }
});

window.addEventListener("beforeunload", (event) => {
    if (dirty) event.preventDefault();
});
window.addEventListener("resize", growAll);

// ---- a new post ----

const newTitle = $<HTMLInputElement>("new-title");
$("new").addEventListener("click", () => {
    newTitle.hidden = false;
    newTitle.focus();
});
newTitle.addEventListener("keydown", async (event) => {
    if (event.key === "Escape") newTitle.hidden = true;
    if (event.key !== "Enter" || !newTitle.value.trim()) return;
    try {
        const { path } = await api<{ path: string }>("/api/new", { title: newTitle.value.trim() });
        newTitle.value = "";
        newTitle.hidden = true;
        await showList();
        await open(path);
        (richNow() ? body : text).focus();
    } catch (error) {
        fail(error);
    }
});

// ---- publishing ----

interface Plan {
    ok: boolean;
    log: string;
    pages: number;
    drafts: string[];
    changed: string;
    message: string;
    dryRun: boolean;
}

const dialog = $<HTMLDialogElement>("dialog");
const report = $("report");
const message = $<HTMLInputElement>("message");
const deploy = $<HTMLButtonElement>("deploy");

$("publish").addEventListener("click", async () => {
    await save();
    report.textContent = "Checking that the site still builds. This takes a few seconds.";
    message.hidden = deploy.hidden = true;
    dialog.showModal();
    try {
        const plan = await api<Plan>("/api/plan", { path: file?.path ?? "" });
        if (!plan.ok) {
            report.textContent = `The check failed, so nothing can be published yet.\n\n${plan.log}`;
            return;
        }
        report.textContent = [
            `Built ${plan.pages} pages.`,
            plan.drafts.length > 0 ? `Still drafts, so NOT going live:\n${plan.drafts.map((draft) => `  ${draft}`).join("\n")}` : "Nothing is marked as a draft.",
            plan.changed ? `Changed files that will be committed:\n${plan.changed}` : "No files changed since the last commit; this would only deploy.",
            plan.dryRun ? "This is a dry run: it will stop before the commit and the deploy." : "",
        ]
            .filter(Boolean)
            .join("\n\n");
        message.value = plan.message;
        message.hidden = !plan.changed;
        deploy.hidden = false;
        deploy.disabled = false;
    } catch (error) {
        report.textContent = error instanceof Error ? error.message : String(error);
    }
});

deploy.addEventListener("click", async () => {
    deploy.disabled = true;
    report.textContent = "Committing, pushing and deploying.";
    try {
        const result = await api<{ ok: boolean; log: string }>("/api/publish", { message: message.value });
        report.textContent = result.log;
        message.hidden = deploy.hidden = true;
        void showList();
    } catch (error) {
        report.textContent = error instanceof Error ? error.message : String(error);
    }
});

$("close").addEventListener("click", () => dialog.close());

// ---- start ----

void showList()
    .then(() => open((files.find((entry) => entry.path === memory.get("last")) ?? files[0])!.path))
    .catch(fail);
