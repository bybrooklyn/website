// The editor page that `bun run edit` and `bun run blog` open. It shows a
// file from the site as formatted text, saves as you type, and can publish.
// Reading and writing Markdown is in markdown.ts; the server is ../write.ts.

import { fieldLine, fields, guard, joinFile, parseBody, parseInline, splitFile, toHtml, toMarkdown, type Block, type Inline } from "./markdown";

interface FileEntry {
    path: string;
    label: string;
    draft: boolean;
}
interface Group {
    label: string;
    files: FileEntry[];
}

const meta = (name: string) => document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content ?? "";
const key = meta("edit-key");
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

const list = $("list");
const front = $("front");
const body = $("body");
const source = $<HTMLTextAreaElement>("source");
const status = $("status");

let current: { path: string; hash: string; front: string[] | null; lead: string; markdown: boolean } | undefined;
/** What each block on the page came from, and what it looked like then. */
const known = new WeakMap<Element, { block: Block; was: string }>();

// ---- showing a file ----

const grow = (area: HTMLTextAreaElement) => {
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight + 2}px`;
};

function island(kind: "code" | "raw" | "image", block: Partial<Block>): HTMLElement {
    const box = el("div", { className: `island ${kind}`, contentEditable: "false" });
    box.dataset.kind = kind;
    const remove = el("button", { className: "island-remove", type: "button", title: "remove this block", textContent: "remove" });
    remove.addEventListener("click", () => {
        box.remove();
        changed();
    });
    if (kind === "image") {
        const url = block.url ?? "";
        const shown = /^https?:/.test(url) ? url : `/api/asset?file=${encodeURIComponent(current?.path ?? "")}&src=${encodeURIComponent(url)}&k=${key}`;
        box.dataset.url = url;
        box.append(el("img", { src: shown, alt: "" }), el("input", { value: block.alt ?? "", placeholder: "describe the picture (alt text)" }), remove);
        return box;
    }
    const area = el("textarea", { value: kind === "code" ? (block.code ?? "") : (block.src ?? ""), spellcheck: false, rows: 1 });
    const head = el("div", { className: "island-head" });
    if (kind === "code") head.append(el("input", { value: block.lang ?? "", placeholder: "language", className: "lang" }));
    else head.append(el("span", {}, "source"));
    head.append(remove);
    box.append(head, area);
    queueMicrotask(() => grow(area));
    return box;
}

function show(block: Block): Element {
    const inline = (text: string) => toHtml(parseInline(text)) || "<br>";
    switch (block.type) {
        case "heading":
            return el(`h${Math.max(block.level!, 1)}` as "h2", { innerHTML: inline(block.text!) });
        case "paragraph":
            return el("p", { innerHTML: inline(block.text!) });
        case "list":
            return el(block.ordered ? "ol" : "ul", { innerHTML: block.items!.map((item) => `<li>${inline(item)}</li>`).join("") });
        case "quote":
            return el("blockquote", { innerHTML: block.paragraphs!.map((paragraph) => `<p>${inline(paragraph)}</p>`).join("") });
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

function showBody(markdown: string): void {
    const { lead, blocks } = parseBody(markdown);
    current!.lead = lead;
    body.replaceChildren();
    for (const block of blocks) {
        const node = show(block);
        body.append(node);
        known.set(node, { block, was: look(node) });
    }
    body.append(el("p", { innerHTML: "<br>" }));
}

function showFront(): void {
    front.replaceChildren();
    const lines = current?.front;
    if (!lines) return;
    const all = fields(lines);
    const set = (line: number, name: string, value: string, quoted: boolean) => {
        lines[line] = fieldLine(name, value, quoted);
        changed();
    };
    const title = all.find((field) => field.key === "title" || field.key === "name");
    const summary = all.find((field) => field.key === "summary");
    if (title) {
        const input = el("textarea", { className: "title", value: title.value, rows: 1, placeholder: "Title" });
        input.addEventListener("input", () => (grow(input), set(title.line, title.key, input.value.replace(/\n/g, " "), true)));
        front.append(input);
        queueMicrotask(() => grow(input));
    }
    if (summary) {
        const input = el("textarea", { className: "summary", value: summary.value, rows: 1, placeholder: "One sentence about this." });
        input.addEventListener("input", () => (grow(input), set(summary.line, "summary", input.value.replace(/\n/g, " "), true)));
        front.append(input);
        queueMicrotask(() => grow(input));
    }
    const details = el("div", { className: "details" });
    for (const field of all) {
        if (field === title || field === summary) continue;
        const flag = !field.quoted && /^(true|false)$/.test(field.value);
        const input = el("input", flag ? { type: "checkbox", checked: field.value === "true" } : { value: field.value });
        input.addEventListener("input", () => set(field.line, field.key, flag ? String(input.checked) : input.value, field.quoted));
        details.append(el("label", { className: flag ? "flag" : "" }, el("span", {}, field.key), input));
    }
    const text = el("textarea", { className: "front-text", value: lines.join("\n"), spellcheck: false, hidden: true });
    text.addEventListener("input", () => {
        grow(text);
        current!.front = text.value.split("\n");
        changed();
    });
    const toggle = el("button", { type: "button", className: "quiet", textContent: "everything, as text" });
    toggle.addEventListener("click", () => {
        if (text.hidden) {
            text.value = current!.front!.join("\n");
            text.hidden = false;
            details.hidden = true;
            toggle.textContent = "back to fields";
            grow(text);
        } else showFront();
    });
    front.append(details, toggle, text);
}

async function open(path: string): Promise<void> {
    await save();
    const file = await api<{ content: string; hash: string }>(`/api/file?path=${encodeURIComponent(path)}`);
    const markdown = /\.mdx?$/.test(path);
    const parts = markdown ? splitFile(file.content) : { front: null, body: file.content };
    current = { path, hash: file.hash, front: parts.front, lead: "", markdown };
    body.hidden = !markdown;
    source.hidden = markdown;
    $("tools").hidden = !markdown;
    showFront();
    if (markdown) showBody(parts.body);
    else {
        source.value = file.content;
        queueMicrotask(() => grow(source));
    }
    for (const link of list.querySelectorAll("button")) link.classList.toggle("here", link.dataset.path === path);
    $<HTMLAnchorElement>("view").href = `/view?path=${encodeURIComponent(path)}&k=${key}`;
    try {
        localStorage.setItem("edit-last", path);
    } catch {
        // remembering the last file is only a convenience
    }
    say("");
    window.scrollTo(0, 0);
}

async function showList(): Promise<Group[]> {
    const groups = await api<Group[]>("/api/files");
    list.replaceChildren();
    for (const group of groups) {
        list.append(el("h2", {}, group.label));
        for (const file of group.files) {
            const link = el("button", { type: "button", className: file.path === current?.path ? "here" : "" }, file.label);
            if (file.draft) link.append(el("small", {}, "draft"));
            link.dataset.path = file.path;
            link.addEventListener("click", () => void open(file.path).catch(fail));
            list.append(link);
        }
    }
    return groups;
}

// ---- reading the page back into Markdown ----

function inlineOf(node: Node): Inline[] {
    const out: Inline[] = [];
    node.childNodes.forEach((child, index) => {
        if (child instanceof Text) out.push({ t: "text", v: child.data.replace(/[\s ]+/g, " ") });
        if (!(child instanceof HTMLElement)) return;
        const tag = child.tagName;
        if (tag === "BR") {
            if (index < node.childNodes.length - 1) out.push({ t: "text", v: " " });
        } else if (tag === "B" || tag === "STRONG") out.push({ t: "strong", m: "**", c: inlineOf(child) });
        else if (tag === "I" || tag === "EM") out.push({ t: "em", m: "*", c: inlineOf(child) });
        else if (tag === "S" || tag === "DEL" || tag === "STRIKE") out.push({ t: "del", m: "~~", c: inlineOf(child) });
        else if (tag === "CODE") out.push({ t: "code", v: child.textContent ?? "" });
        else if (tag === "A") out.push({ t: "link", href: child.getAttribute("href") ?? "", c: inlineOf(child) });
        else if (tag !== "UL" && tag !== "OL") out.push(...inlineOf(child));
    });
    return out;
}

/** Tidy what a browser leaves behind: empty marks, and spaces inside the ends of a mark. */
function tidy(nodes: Inline[]): Inline[] {
    const out: Inline[] = [];
    const text = (v: string) => {
        const last = out[out.length - 1];
        if (!v) return;
        if (last?.t === "text") last.v += v;
        else out.push({ t: "text", v });
    };
    for (const node of nodes) {
        if (node.t === "text") text(node.v);
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
            text(before);
            if (kept.length > 0) out.push({ ...node, c: kept });
            text(after);
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
    if (/^H[1-6]$/.test(tag)) {
        const text = lineOf(node);
        return text ? `${"#".repeat(Number(tag[1]))} ${text}` : "";
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

const BLOCK = /^(P|DIV|UL|OL|BLOCKQUOTE|H[1-6]|HR|PRE)$/;

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
            const text = blockOf(node);
            if (text) parts.push({ text, gap: "\n\n" });
        }
    }
    return (
        current!.lead +
        parts.map((part, index) => part.text + (index === parts.length - 1 ? "\n" : part.gap.length > 1 ? part.gap : "\n\n")).join("")
    );
}

// ---- saving ----

let timer = 0;
let dirty = false;
let saving: Promise<void> = Promise.resolve();

function say(text: string, bad = false): void {
    status.textContent = text;
    status.classList.toggle("bad", bad);
}
const fail = (error: unknown) => say(error instanceof Error ? error.message : String(error), true);

function changed(): void {
    dirty = true;
    say("not saved yet");
    clearTimeout(timer);
    timer = window.setTimeout(() => void save(), 700);
}

function save(): Promise<void> {
    clearTimeout(timer);
    saving = saving.then(async () => {
        if (!dirty || !current) return;
        dirty = false;
        const file = current;
        const content = file.markdown ? joinFile(file.front, read()) : source.value;
        try {
            const result = await api<{ hash: string }>("/api/save", { path: file.path, content, hash: file.hash });
            file.hash = result.hash;
            if (!dirty) say("saved");
        } catch (error) {
            dirty = true;
            fail(error);
        }
    });
    return saving;
}

// ---- the toolbar ----

// execCommand is marked as deprecated, but nothing has replaced it for
// formatting editable text, and every browser still does it.
const editing = document as unknown as { execCommand(name: string, ui: boolean, value?: string): boolean };
const command = (name: string, value?: string) => editing.execCommand(name, false, value);

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
    if (!node.nextElementSibling) body.append(el("p", { innerHTML: "<br>" }));
    changed();
}

function inside(tag: string): HTMLElement | null {
    const node = getSelection()?.anchorNode;
    const start = node instanceof Element ? node : node?.parentElement;
    const found = start?.closest<HTMLElement>(tag) ?? null;
    return found && body.contains(found) ? found : null;
}

let linkRange: Range | undefined;

const tools: Record<string, () => void> = {
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
    raw() {
        const box = island("raw", { src: "" });
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
    tools[name]?.();
    flatten();
    changed();
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
    const file = input.files?.[0];
    input.value = "";
    if (!file || !current) return;
    try {
        const { url } = await api<{ url: string }>(`/api/upload?file=${encodeURIComponent(current.path)}&name=${encodeURIComponent(file.name)}`, undefined, file);
        place(island("image", { url, alt: "" }));
    } catch (error) {
        fail(error);
    }
});

// ---- typing ----

command("defaultParagraphSeparator", "p");

/** Markdown typed at the start of a line turns into the thing it means. */
const SHORTHAND: Record<string, string> = { "##": "h2", "###": "h3", "-": "ul", "*": "ul", "1.": "ol", ">": "quote", "```": "codeblock", "---": "rule" };

body.addEventListener("input", (event) => {
    const block = here();
    if ((event as InputEvent).data === " " && block?.tagName === "P") {
        const typed = (block.textContent ?? "").replace(/[\s ]+$/, "");
        const tool = SHORTHAND[typed];
        if (tool && (block.textContent ?? "").length === typed.length + 1) {
            block.innerHTML = "<br>";
            getSelection()?.collapse(block, 0);
            tools[tool]?.();
        }
    }
    flatten();
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) grow(target);
    if (!body.lastElementChild || body.lastElementChild.classList.contains("island")) body.append(el("p", { innerHTML: "<br>" }));
    changed();
});

body.addEventListener("paste", (event) => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    command("insertText", event.clipboardData?.getData("text/plain") ?? "");
});

body.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && inside("li") && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        command(event.shiftKey ? "outdent" : "indent");
    }
});

source.addEventListener("input", () => {
    grow(source);
    changed();
});

document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        dirty = dirty || Boolean(current);
        void save();
    }
});

window.addEventListener("beforeunload", (event) => {
    if (dirty) event.preventDefault();
});

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
        await open(path);
        await showList();
        body.focus();
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
        const plan = await api<Plan>("/api/plan", { path: current?.path ?? "" });
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
    .then((groups) => {
        const all = groups.flatMap((group) => group.files);
        let last: string | null = null;
        try {
            last = localStorage.getItem("edit-last");
        } catch {
            // no memory of the last file; start from the first
        }
        const posts = all.filter((file) => file.path.includes("/blog/"));
        const first = meta("edit-mode") === "blog" ? (posts.find((file) => file.draft) ?? posts[0]) : all.find((file) => file.path === last);
        if (meta("edit-mode") === "blog" && !first) $("new").click();
        return open((first ?? all[0])!.path);
    })
    .catch(fail);
