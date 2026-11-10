// How the editor reads and writes a Markdown or MDX file.
//
// The rule that keeps it honest: a file is cut into blocks, every block
// remembers its exact source, and a block nobody touched is written back
// exactly as it was. Only what the editor can show faithfully (headings,
// paragraphs, simple lists, quotes, tables, code, pictures) becomes formatted
// text; everything else (imports, components) is shown as its source.

// ---- frontmatter ----

export interface Field {
    key: string;
    value: string;
    /** Written as a quoted string in the file. */
    quoted: boolean;
    line: number;
}

export function splitFile(source: string): { front: string[] | null; body: string } {
    if (!source.startsWith("---\n")) return { front: null, body: source };
    const end = source.indexOf("\n---", 3);
    if (end < 0) return { front: null, body: source };
    const after = source.indexOf("\n", end + 4);
    return { front: source.slice(4, end).split("\n"), body: after < 0 ? "" : source.slice(after + 1) };
}

export function joinFile(front: string[] | null, body: string): string {
    return front ? `---\n${front.join("\n")}\n---\n${body}` : body;
}

/** The one-line `key: value` entries. Lists, nested values and comments are left alone. */
export function fields(front: string[]): Field[] {
    const found: Field[] = [];
    front.forEach((text, line) => {
        const match = /^([A-Za-z_][\w-]*):[ \t]*(.*?)\s*$/.exec(text);
        if (!match || match[2] === "" || /^[|>&*!]/.test(match[2]!) || /^\s+\S/.test(front[line + 1] ?? "")) return;
        const [, key, raw] = match as unknown as [string, string, string];
        if (/^".*"$/.test(raw)) {
            try {
                found.push({ key, value: JSON.parse(raw) as string, quoted: true, line });
                return;
            } catch {
                // not a plain quoted string; show it as written
            }
        }
        found.push({ key, value: raw, quoted: false, line });
    });
    return found;
}

export function fieldLine(key: string, value: string, quoted: boolean): string {
    const bare = !quoted && (/^[[{]/.test(value) || (/^[\w ./,-]+$/.test(value) && value.trim() === value));
    return `${key}: ${bare ? value : JSON.stringify(value)}`;
}

// ---- text inside a block ----

export type Inline =
    | { t: "text"; v: string }
    | { t: "code"; v: string }
    | { t: "strong" | "em" | "del"; m: string; c: Inline[] }
    | { t: "link"; href: string; c: Inline[] };

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const MARKS = [["**", "strong"], ["__", "strong"], ["~~", "del"], ["*", "em"], ["_", "em"]] as const;

function linkAt(s: string, start: number): { label: string; href: string; end: number } | undefined {
    let depth = 0;
    for (let i = start; i < s.length; i++) {
        if (s[i] === "\\") i++;
        else if (s[i] === "[") depth++;
        else if (s[i] === "]" && --depth === 0) {
            const match = /^\(([^\s()]+)\)/.exec(s.slice(i + 1));
            return match ? { label: s.slice(start + 1, i), href: match[1]!, end: i + 1 + match[0].length } : undefined;
        }
    }
    return undefined;
}

function closing(s: string, from: number, mark: string): number {
    for (let k = from; k < s.length; k++) {
        if (s[k] === "\\") k++;
        else if (s[k] === "`") {
            const end = s.indexOf("`", k + 1);
            if (end > 0) k = end;
        } else if (mark.length === 1 && s.startsWith(mark + mark, k)) {
            const end = s.indexOf(mark + mark, k + 2);
            if (end < 0) return -1;
            k = end + 1;
        } else if (s.startsWith(mark, k) && k > from - 1 && !/\s/.test(s[k - 1]!)) {
            if (mark[0] === "_" && /\w/.test(s[k + mark.length] ?? "")) continue;
            return k;
        }
    }
    return -1;
}

export function parseInline(s: string): Inline[] {
    const out: Inline[] = [];
    let text = "";
    const flush = () => {
        if (text) out.push({ t: "text", v: text });
        text = "";
    };
    scan: for (let i = 0; i < s.length; ) {
        const ch = s[i]!;
        if (ch === "\\" && PUNCTUATION.test(s[i + 1] ?? "")) {
            text += s[i + 1];
            i += 2;
            continue;
        }
        if (ch === "`" && s[i + 1] !== "`") {
            const end = s.indexOf("`", i + 1);
            if (end > i) {
                flush();
                out.push({ t: "code", v: s.slice(i + 1, end) });
                i = end + 1;
                continue;
            }
        }
        if (ch === "[") {
            const link = linkAt(s, i);
            if (link) {
                flush();
                out.push({ t: "link", href: link.href, c: parseInline(link.label) });
                i = link.end;
                continue;
            }
        }
        for (const [mark, t] of MARKS) {
            if (!s.startsWith(mark, i)) continue;
            const next = s[i + mark.length];
            if (!next || /\s/.test(next) || (mark[0] === "_" && /\w/.test(s[i - 1] ?? ""))) break;
            const end = closing(s, i + mark.length + 1, mark);
            if (end < 0) break;
            flush();
            out.push({ t, m: mark, c: parseInline(s.slice(i + mark.length, end)) });
            i = end + mark.length;
            continue scan;
        }
        text += ch;
        i++;
    }
    flush();
    return out;
}

function escapeText(v: string): string {
    let out = "";
    for (let i = 0; i < v.length; i++) {
        const ch = v[i]!;
        const before = v[i - 1];
        const after = v[i + 1];
        const open = (c: string | undefined) => c === undefined || /\s/.test(c);
        const risky =
            "\\`<{}".includes(ch) ||
            (ch === "*" && !(open(before) && open(after))) ||
            (ch === "_" && !(open(before) && open(after)) && !(/\w/.test(before ?? "") && /\w/.test(after ?? ""))) ||
            (ch === "~" && after === "~") ||
            (ch === "[" && v.indexOf("](", i) > 0);
        out += risky ? `\\${ch}` : ch;
    }
    return out;
}

/** Back to Markdown. `keep` reuses the marks the source used, to test that nothing is lost. */
export function toMarkdown(nodes: Inline[], keep = false): string {
    return nodes
        .map((node) => {
            if (node.t === "text") return escapeText(node.v);
            if (node.t === "code") return `\`${node.v}\``;
            if (node.t === "link") return `[${toMarkdown(node.c, keep)}](${node.href})`;
            const mark = keep ? node.m : { strong: "**", em: "*", del: "~~" }[node.t];
            return mark + toMarkdown(node.c, keep) + mark;
        })
        .join("");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toHtml(nodes: Inline[]): string {
    return nodes
        .map((node) => {
            if (node.t === "text") return escapeHtml(node.v);
            if (node.t === "code") return `<code>${escapeHtml(node.v)}</code>`;
            if (node.t === "link") return `<a href="${escapeHtml(node.href)}">${toHtml(node.c)}</a>`;
            const tag = { strong: "strong", em: "em", del: "s" }[node.t];
            return `<${tag}>${toHtml(node.c)}</${tag}>`;
        })
        .join("");
}

/** True if the editor reads this text the way Markdown does: no components, pictures, footnotes or entities in it. */
const faithful = (text: string) => !/[<{}]|!\[|\[\^|``|&#?\w+;|\\(?![!-/:-@[-`{-~])/.test(text);

// ---- blocks ----

export interface Block {
    type: "heading" | "paragraph" | "list" | "quote" | "table" | "code" | "rule" | "image" | "raw";
    /** Exactly what the file says, and the blank lines after it. */
    src: string;
    gap: string;
    level?: number;
    text?: string;
    ordered?: boolean;
    items?: string[];
    paragraphs?: string[];
    lang?: string;
    code?: string;
    alt?: string;
    url?: string;
    /** A table: its heading cells, each column's alignment mark, and its rows. */
    head?: string[];
    align?: string[];
    rows?: string[][];
}

export interface Body {
    lead: string;
    blocks: Block[];
}

const blank = (line: string | undefined) => line === undefined || /^\s*$/.test(line);
const FENCE = /^(`{3,}|~{3,})(.*)$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const ITEM = /^([-*+]|\d+[.)])[ \t]+(.*)$/;

function untilBlank(lines: string[], from: number): number {
    let end = from;
    while (end < lines.length && !blank(lines[end])) end++;
    return end;
}

/** Where a component that starts on this line ends, counting its own name opening and closing. */
function componentEnd(lines: string[], from: number): number {
    const name = /^<([A-Za-z][\w.]*)/.exec(lines[from]!)?.[1];
    if (!name) return untilBlank(lines, from);
    const tag = new RegExp(`<(/?)${name.replace(/\./g, "\\.")}(?![\\w.])[^>]*?(/?)>`, "g");
    let text = "";
    for (let line = from; line < lines.length; line++) {
        text += `${lines[line]}\n`;
        let depth = 0;
        let seen = false;
        for (const match of text.matchAll(tag)) {
            seen = true;
            if (match[1]) depth--;
            else if (!match[2]) depth++;
        }
        if (seen && depth <= 0) return untilBlank(lines, line);
    }
    return untilBlank(lines, from);
}

const cells = (row: string): string[] =>
    row
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim());

/** A table as Markdown, its columns padded to line up. */
export function tableMarkdown(head: string[], align: string[], rows: string[][]): string {
    const widths = head.map((cell, column) => Math.max(3, cell.length, ...rows.map((row) => (row[column] ?? "").length)));
    const line = (row: string[]) => `| ${widths.map((width, column) => (row[column] ?? "").padEnd(width)).join(" | ")} |`;
    const rule = widths.map((width, column) => {
        const mark = align[column] ?? "---";
        return (mark.startsWith(":") ? ":" : "-") + "-".repeat(width - 2) + (mark.endsWith(":") ? ":" : "-");
    });
    return [line(head), `| ${rule.join(" | ")} |`, ...rows.map(line)].join("\n");
}

function read(lines: string[], at: number): [Omit<Block, "src" | "gap">, number] {
    const line = lines[at]!;
    const raw = (end: number): [Omit<Block, "src" | "gap">, number] => [{ type: "raw" }, end];

    const fence = FENCE.exec(line);
    if (fence) {
        let end = at + 1;
        while (end < lines.length && !lines[end]!.startsWith(fence[1]!)) end++;
        const closed = end < lines.length;
        return [{ type: "code", lang: fence[2]!.trim(), code: lines.slice(at + 1, end).join("\n") }, closed ? end + 1 : end];
    }
    if (line.startsWith("<")) return raw(componentEnd(lines, at));
    if (line.startsWith("|")) {
        // A plain pipe table: a heading row, a row of dashes, then rows of the same width.
        const end = untilBlank(lines, at);
        const table = lines.slice(at, end);
        const [head, align, ...rows] = table.map(cells);
        const plain =
            head !== undefined &&
            align !== undefined &&
            align.length === head.length &&
            align.every((mark) => /^:?-+:?$/.test(mark)) &&
            table.every((row) => /^\|.*\|\s*$/.test(row) && !/\\\||`/.test(row)) &&
            rows.every((row) => row.length === head.length) &&
            [head, ...rows].flat().every(faithful);
        return plain ? [{ type: "table", head, align, rows }, end] : raw(end);
    }
    if (/^(import|export)\s|^[{]|^\s/.test(line)) return raw(untilBlank(lines, at));

    const heading = HEADING.exec(line);
    if (heading) {
        return faithful(heading[2]!) ? [{ type: "heading", level: heading[1]!.length, text: heading[2]! }, at + 1] : raw(at + 1);
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) return [{ type: "rule" }, at + 1];

    const end = untilBlank(lines, at);
    const chunk = lines.slice(at, end);

    if (ITEM.test(line)) {
        // A list whose items are spaced out, nested or more than plain text stays as source.
        let all = end;
        while (!blank(lines[all + 1]) && blank(lines[all]) && (ITEM.test(lines[all + 1]!) || /^\s/.test(lines[all + 1]!))) all = untilBlank(lines, all + 1);
        if (all !== end) return raw(all);
        const ordered = /^\d/.test(line);
        const items: string[] = [];
        for (const row of chunk) {
            const item = ITEM.exec(row);
            if (item && /^\d/.test(row) === ordered) items.push(item[2]!);
            else if (!item && /^\s+\S/.test(row) && !ITEM.test(row.trim()) && items.length > 0) items[items.length - 1] += ` ${row.trim()}`;
            else return raw(end);
        }
        return items.every(faithful) ? [{ type: "list", ordered, items }, end] : raw(end);
    }
    if (line.startsWith(">")) {
        if (!chunk.every((row) => row.startsWith(">"))) return raw(end);
        const paragraphs = chunk
            .map((row) => row.replace(/^> ?/, "").trim())
            .join("\n")
            .split(/\n{2,}/)
            .map((paragraph) => paragraph.replace(/\n/g, " "));
        const plain = paragraphs.every((paragraph) => paragraph !== "" && faithful(paragraph) && !/^([>#]|[-*+]\s|\d+[.)]\s|`{3})/.test(paragraph));
        return plain ? [{ type: "quote", paragraphs }, end] : raw(end);
    }
    const image = chunk.length === 1 && /^!\[([^\]]*)\]\(([^\s()]+)\)$/.exec(line);
    if (image) return [{ type: "image", alt: image[1]!, url: image[2]! }, end];

    // A paragraph runs to the next blank line, or to a fence or heading that cuts in.
    let stop = at + 1;
    while (stop < end && !FENCE.test(lines[stop]!) && !HEADING.test(lines[stop]!)) stop++;
    const rows = lines.slice(at, stop);
    const text = rows.map((row) => row.trim()).join(" ");
    const broken = rows.some((row) => / {2,}$|\\$/.test(row));
    return !broken && faithful(text) ? [{ type: "paragraph", text }, stop] : raw(stop);
}

export function parseBody(body: string): Body {
    const lines = body.split("\n");
    const blocks: Block[] = [];
    let at = 0;
    while (at < lines.length && blank(lines[at])) at++;
    if (at >= lines.length) return { lead: body, blocks };
    const lead = lines.slice(0, at).map((line) => `${line}\n`).join("");
    while (at < lines.length) {
        const [block, end] = read(lines, at);
        let next = end;
        while (next < lines.length && blank(lines[next])) next++;
        const between = lines.slice(end, next);
        const gap = (end < lines.length ? "\n" : "") + (next < lines.length ? between.map((line) => `${line}\n`).join("") : between.join("\n"));
        blocks.push({ ...block, src: lines.slice(at, end).join("\n"), gap });
        at = next;
    }
    return { lead, blocks };
}

export const writeBody = ({ lead, blocks }: Body): string => lead + blocks.map((block) => block.src + block.gap).join("");

/** A line of running text that would be read as something else at the start of a block. */
export const guard = (markdown: string): string => (/^(#{1,6}\s|[-+*]\s|\d+[.)]\s|>|`{3}|~{3}|[-_]{3,}$)/.test(markdown) ? `\\${markdown}` : markdown);
