// YAML read and written by hand: the common part of YAML 1.2 that settings files and data use, read
// exactly, and everything past it refused in plain words with its line, never guessed at.
//
// Read: mappings and lists laid out by indentation (spaces only), flow lists `[a, b]` and mappings
// `{a: 1}`, plain, single-quoted and double-quoted values (with every escape YAML has), `|` and `>`
// blocks with `-` and `+` and an indentation number, comments, a `---` at the start and a `...` at the
// end. Values are typed by the 1.2 core schema: `null`, `~` and nothing are null; `true` and `false`
// (and their capitalized forms) are true and false, so `yes`, `no`, `on` and `off` stay words; integers in
// decimal, `0x` and `0o`; floats, `.inf` and `.nan`. Refused: anchors and aliases (`&`, `*`), tags
// (`!`), directives (`%YAML`), more than one document in a file, complex keys (`? `), merge keys (`<<`)
// and a key given twice.
//
// Written: block layout, two spaces a level, a string in double quotes only where it would otherwise
// read back as something else, a string of several lines as a `|` block, empty collections as `[]` and
// `{}`.
//
//   readYaml("name: Jo\n");    gives { name: "Jo" }
//   writeYaml({ name: "Jo" });  gives "name: Jo\n"

import { DataError } from "./errors";
import type { Value } from "./data";

type Table = { [key: string]: Value };

/** Sets a key on an object as its own property, so that a key such as `__proto__` is only a key. */
export function put(table: Table, key: string, value: Value): void {
    Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true });
}

/** A plain value read by the core schema: null, a boolean, a number, or the text itself. */
export function resolve(text: string): Value {
    if (text === "" || text === "~" || /^(null|Null|NULL)$/.test(text)) return null;
    if (/^(true|True|TRUE)$/.test(text)) return true;
    if (/^(false|False|FALSE)$/.test(text)) return false;
    if (/^[-+]?[0-9]+$/.test(text)) return Number(text);
    if (/^0o[0-7]+$/.test(text)) return parseInt(text.slice(2), 8);
    if (/^0x[0-9a-fA-F]+$/.test(text)) return parseInt(text.slice(2), 16);
    if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(text)) return Number(text);
    if (/^[-+]?\.(inf|Inf|INF)$/.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
    if (/^\.(nan|NaN|NAN)$/.test(text)) return NaN;
    return text;
}

const ESCAPES: Record<string, string> = { "0": "\0", a: "\x07", b: "\b", t: "\t", "\t": "\t", n: "\n", v: "\v", f: "\f", r: "\r", e: "\x1b", " ": " ", '"': '"', "/": "/", "\\": "\\", N: "\u0085", _: "\u00a0", L: "\u2028", P: "\u2029" };

/** Reads one YAML document into a value. Throws a DataError, with its line, on anything past the subset read. */
export function readYaml(text: string): Value {
    const source = text.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
    const lines = source.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    const starts: number[] = [];
    let offset = 0;
    for (const line of source.split("\n")) {
        starts.push(offset);
        offset += line.length + 1;
    }
    /** The line, counted from one, that a place in the source is on. */
    const lineAt = (at: number): number => {
        let low = 0;
        let high = starts.length - 1;
        while (low < high) {
            const middle = (low + high + 1) >> 1;
            if (starts[middle]! <= at) low = middle;
            else high = middle - 1;
        }
        return low + 1;
    };
    const fail = (message: string, line: number): never => {
        throw new DataError(message, { line });
    };
    let i = 0;
    const blank = (line: string) => /^\s*(#.*)?$/.test(line);
    const skip = () => {
        while (i < lines.length && blank(lines[i]!)) i++;
    };
    const marker = (line: string) => /^(---|\.\.\.)(\s|$)/.test(line);
    const indentOf = (k: number): number => {
        const line = lines[k]!;
        const spaces = /^ */.exec(line)![0].length;
        if (line[spaces] === "\t") fail(`Line ${k + 1} is indented with a tab. YAML allows only spaces there.`, k + 1);
        return spaces;
    };
    const refuseSigns = (text: string, line: number) => {
        if (text[0] === "&" || text[0] === "*") fail(`Line ${line} uses an anchor or an alias (& or *), which this converter does not read. Write the value out in full.`, line);
        if (text[0] === "!") fail(`Line ${line} uses a tag (!), which this converter does not read.`, line);
    };

    // ---- flow: [ ], { }, quoted and plain values read character by character, across lines ----
    /** Reads one flow value starting at a place in the source, giving it and the place after it; with `keyOnly`, only a quoted key. */
    function flow(at: number, keyOnly: boolean): { value: Value; end: number } {
        let pos = at;
        const space = () => {
            for (;;) {
                const char = source[pos];
                if (char === " " || char === "\t" || char === "\n") pos++;
                else if (char === "#" && (pos === 0 || /\s/.test(source[pos - 1]!))) {
                    while (pos < source.length && source[pos] !== "\n") pos++;
                } else return;
            }
        };
        const value = (inFlow: boolean): Value => {
            space();
            const char = source[pos];
            const line = lineAt(pos);
            if (char === undefined) return fail(`The file ends where a value was expected, on line ${line}.`, line);
            if (char === "[") {
                pos++;
                const list: Value[] = [];
                for (;;) {
                    space();
                    if (pos >= source.length) fail(`A [ opened on line ${line} is never closed.`, line);
                    if (source[pos] === "]") {
                        pos++;
                        return list;
                    }
                    const item = value(true);
                    space();
                    if (source[pos] === ":") fail(`Line ${lineAt(pos)} has a key and value inside [ ], which this converter does not read. Write it as { key: value }.`, lineAt(pos));
                    list.push(item);
                    if (pos >= source.length) fail(`A [ opened on line ${line} is never closed.`, line);
                    if (source[pos] === ",") pos++;
                    else if (source[pos] !== "]") fail(`Line ${lineAt(pos)} needs a comma or a ] here.`, lineAt(pos));
                }
            }
            if (char === "{") {
                pos++;
                const table: Table = {};
                const seen = new Map<string, number>();
                for (;;) {
                    space();
                    if (pos >= source.length) fail(`A { opened on line ${line} is never closed.`, line);
                    if (source[pos] === "}") {
                        pos++;
                        return table;
                    }
                    const keyLine = lineAt(pos);
                    if (source[pos] === "?") fail(`Line ${keyLine} uses a complex key (?), which this converter does not read.`, keyLine);
                    refuseSigns(source.slice(pos), keyLine);
                    const key = source[pos] === '"' || source[pos] === "'" ? (quoted() as string) : plain(true);
                    checkKey(key, seen, keyLine);
                    space();
                    let item: Value = null;
                    if (source[pos] === ":") {
                        pos++;
                        space();
                        if (source[pos] !== "," && source[pos] !== "}") item = value(true);
                    }
                    put(table, key, item);
                    space();
                    if (pos >= source.length) fail(`A { opened on line ${line} is never closed.`, line);
                    if (source[pos] === ",") pos++;
                    else if (source[pos] !== "}") fail(`Line ${lineAt(pos)} needs a comma or a } here.`, lineAt(pos));
                }
            }
            if (char === '"' || char === "'") return quoted();
            refuseSigns(char, line);
            if (inFlow && (char === "|" || char === ">")) fail(`Line ${line} has a block marker (${char}) inside [ ] or { }, where YAML does not allow one.`, line);
            if (char === "]" || char === "}" || char === ",") fail(`Line ${line} has a ${char} where a value was expected.`, line);
            return resolve(plain(false));
        };
        /** A plain value inside [ ] or { }: up to a comma, a bracket, a `: ` or a comment, folded across lines. */
        const plain = (key: boolean): string => {
            let out = "";
            for (;;) {
                const char = source[pos];
                if (char === undefined || ",[]{}".includes(char)) break;
                if (char === ":" && (pos + 1 >= source.length || /[\s,\]}[{]/.test(source[pos + 1]!))) break;
                if (char === "#" && /\s/.test(source[pos - 1] ?? "")) break;
                if (char === "\n") {
                    out = out.trimEnd();
                    const back = pos;
                    space();
                    const next = source[pos];
                    if (next === undefined || ",[]{}:#".includes(next)) break;
                    if (pos > back) out += " ";
                    continue;
                }
                out += char;
                pos++;
            }
            out = out.trim();
            if (out === "" && !key) fail(`Line ${lineAt(pos)} is missing a value here.`, lineAt(pos));
            return out;
        };
        /** A quoted value, single or double, with its escapes and its line breaks folded. */
        const quoted = (): string => {
            const quote = source[pos]!;
            const line = lineAt(pos);
            pos++;
            let out = "";
            for (;;) {
                const char = source[pos];
                if (char === undefined) return fail(`A quote opened on line ${line} is never closed.`, line);
                if (char === quote) {
                    if (quote === "'" && source[pos + 1] === "'") {
                        out += "'";
                        pos += 2;
                        continue;
                    }
                    pos++;
                    return out;
                }
                if (char === "\\" && quote === '"') {
                    const sign = source[pos + 1];
                    if (sign === "\n") {
                        pos += 2;
                        while (source[pos] === " " || source[pos] === "\t") pos++;
                        continue;
                    }
                    const sizes: Record<string, number> = { x: 2, u: 4, U: 8 };
                    if (sign !== undefined && sizes[sign]) {
                        const digits = source.slice(pos + 2, pos + 2 + sizes[sign]!);
                        if (!/^[0-9a-fA-F]+$/.test(digits) || digits.length !== sizes[sign]) fail(`Line ${lineAt(pos)} has an escape \\${sign} without its ${sizes[sign]} hex digits.`, lineAt(pos));
                        const code = parseInt(digits, 16);
                        if (code > 0x10ffff) fail(`Line ${lineAt(pos)} has an escape for a character that does not exist.`, lineAt(pos));
                        out += String.fromCodePoint(code);
                        pos += 2 + sizes[sign]!;
                        continue;
                    }
                    if (sign === undefined || ESCAPES[sign] === undefined) fail(`Line ${lineAt(pos)} has an escape \\${sign ?? ""} that YAML does not have.`, lineAt(pos));
                    out += ESCAPES[sign!];
                    pos += 2;
                    continue;
                }
                if (char === "\n") {
                    // a line break inside quotes folds: one break is a space, each blank line a break
                    out = out.replace(/[ \t]+$/, "");
                    let breaks = 0;
                    while (pos < source.length && /\s/.test(source[pos]!)) {
                        if (source[pos] === "\n") breaks++;
                        pos++;
                    }
                    out += breaks === 1 ? " " : "\n".repeat(breaks - 1);
                    continue;
                }
                out += char;
                pos++;
            }
        };
        const checkKey = (key: string, seen: Map<string, number>, line: number) => {
            if (key === "<<") fail(`Line ${line} uses a merge key (<<), which this converter does not read. Write the keys out in full.`, line);
            const before = seen.get(key);
            if (before !== undefined) fail(`The key "${key}" is given twice, on lines ${before} and ${line}.`, line);
            seen.set(key, line);
        };
        const got = keyOnly ? quoted() : value(true);
        return { value: got, end: pos };
    }

    /** The key of a line of a mapping and where its value starts in the line, or undefined when the line is no key. */
    function keyAt(k: number, column: number): { key: string; after: number } | undefined {
        const line = lines[k]!;
        const text = line.slice(column);
        if (text[0] === '"' || text[0] === "'") {
            const read = flow(starts[k]! + column, true);
            const end = read.end - starts[k]!;
            if (lineAt(read.end) !== k + 1) return undefined;
            const rest = line.slice(end);
            const colon = /^[ \t]*:(?=[ \t]|$)/.exec(rest);
            return colon ? { key: read.value as string, after: end + colon[0].length } : undefined;
        }
        if (text[0] === "[" || text[0] === "{") return undefined;
        for (let j = 0; j < text.length; j++) {
            if (text[j] === "#" && (j === 0 || /\s/.test(text[j - 1]!))) return undefined;
            if (text[j] === ":" && (j + 1 === text.length || text[j + 1] === " " || text[j + 1] === "\t")) return { key: text.slice(0, j).trimEnd(), after: column + j + 1 };
        }
        return undefined;
    }

    /** A node whose lines are indented more than `parent`, or null when there is none. */
    function below(parent: number): Value {
        skip();
        if (i >= lines.length || (marker(lines[i]!) && parent < 0)) return null;
        const indent = indentOf(i);
        if (indent <= parent) return null;
        return at(indent, parent);
    }

    /** The node that starts at a column of the line being read. */
    function at(column: number, parent: number): Value {
        const text = lines[i]!.slice(column);
        if (/^-( |$)/.test(text)) return list(column);
        if (/^\?( |$)/.test(text)) fail(`Line ${i + 1} uses a complex key (?), which this converter does not read.`, i + 1);
        refuseSigns(text, i + 1);
        if (keyAt(i, column)) return mapping(column);
        return inline(column, parent);
    }

    /** A value that starts on the line being read at a column: a block, a flow value, a quoted or a plain one. */
    function inline(column: number, parent: number): Value {
        const line = lines[i]!;
        const text = line.slice(column);
        const number = i + 1;
        refuseSigns(text, number);
        if (text[0] === "|" || text[0] === ">") return block(text, parent);
        if ("[{\"'".includes(text[0]!)) {
            const read = flow(starts[i]! + column, false);
            const last = lineAt(read.end);
            const rest = source.slice(read.end, starts[last] !== undefined ? starts[last]! - 1 : source.length);
            if (!/^([ \t]+#.*)?[ \t]*$/.test(rest)) {
                if (/^[ \t]*:/.test(rest)) fail(`Line ${last} has a key in quotes or brackets that is not read here. Keep a quoted key on one line, and write keys in brackets as plain words.`, last);
                fail(`Line ${last} has something after the value that is not understood.`, last);
            }
            i = last;
            return read.value;
        }
        // a plain value, folded with the lines under it until a line no deeper than its parent
        let first = text;
        const cut = /(^|[ \t])#/.exec(first);
        if (cut) first = first.slice(0, cut.index);
        first = first.trim();
        if (/:( |\t|$)/.test(first)) fail(`Line ${number} has a value with ": " in it. Put the value in quotes.`, number);
        const parts = [first];
        let breaks = 0;
        let k = i + 1;
        let end = i + 1;
        while (k < lines.length) {
            const next = lines[k]!;
            if (/^\s*$/.test(next)) {
                breaks++;
                k++;
                continue;
            }
            if (/^\s*#/.test(next) || (parent < 0 && marker(next))) break;
            const indent = /^ */.exec(next)![0].length;
            if (indent <= parent) break;
            if (cut) fail(`Line ${k + 1} goes on with a value after a comment, which YAML does not allow.`, k + 1);
            if (keyAt(k, indent) || /^-( |$)/.test(next.slice(indent))) fail(`Line ${k + 1} is indented under a value that is already given.`, k + 1);
            let more = next.trim();
            const comment = /(^|[ \t])#/.exec(more);
            if (comment) more = more.slice(0, comment.index).trim();
            parts.push(breaks ? "\n".repeat(breaks) : " ", more);
            breaks = 0;
            k++;
            end = k;
            if (comment) break;
        }
        i = end;
        return parts.length === 1 ? resolve(first) : parts.join("");
    }

    /** A `|` or `>` block, its lines those under it indented further than its parent. */
    function block(header: string, parent: number): Value {
        const number = i + 1;
        const sign = /^([|>])(?:([1-9])([-+])?|([-+])([1-9])?)?[ \t]*(#.*)?$/.exec(header);
        if (!sign) return fail(`The block marker on line ${number} is not understood.`, number);
        const folded = sign[1] === ">";
        const given = Number(sign[2] ?? sign[5] ?? 0);
        const chomp = sign[3] ?? sign[4] ?? "";
        let k = i + 1;
        let indent = given ? (parent < 0 ? given : parent + given) : -1;
        if (indent < 0) {
            for (let look = k; look < lines.length; look++) {
                if (/^ *$/.test(lines[look]!)) continue;
                indent = /^ */.exec(lines[look]!)![0].length;
                break;
            }
            // a first line no deeper than the parent belongs to it: the block is empty
            if (indent <= parent) indent = Number.POSITIVE_INFINITY;
        }
        const kept: string[] = [];
        while (k < lines.length) {
            const line = lines[k]!;
            if (/^ *$/.test(line)) {
                kept.push("");
                k++;
                continue;
            }
            const spaces = /^ */.exec(line)![0].length;
            if (spaces < indent || (indent === 0 && marker(line))) break;
            kept.push(line.slice(indent));
            k++;
        }
        let trail = 0;
        while (kept.length && kept[kept.length - 1] === "") {
            kept.pop();
            trail++;
        }
        i = k;
        if (!kept.length) return chomp === "+" ? "\n".repeat(trail) : "";
        let body: string;
        if (!folded) body = kept.join("\n");
        else {
            body = "";
            let blanks = 0;
            let normal = false;
            let begun = false;
            for (const line of kept) {
                if (line === "") {
                    blanks++;
                    continue;
                }
                const deeper = line[0] === " " || line[0] === "\t";
                if (!begun) body += "\n".repeat(blanks);
                else if (!deeper && normal) body += blanks ? "\n".repeat(blanks) : " ";
                else body += "\n".repeat(blanks + 1);
                body += line;
                blanks = 0;
                normal = !deeper;
                begun = true;
            }
        }
        if (chomp === "-") return body;
        if (chomp === "+") return `${body}\n${"\n".repeat(trail)}`;
        return `${body}\n`;
    }

    /** A block mapping whose keys stand at a column. */
    function mapping(column: number): Table {
        const table: Table = {};
        const seen = new Map<string, number>();
        for (;;) {
            skip();
            if (i >= lines.length || (column === 0 && marker(lines[i]!))) break;
            const indent = indentOf(i);
            if (indent < column) break;
            const number = i + 1;
            if (indent > column) fail(`Line ${number} is indented more than the keys around it.`, number);
            const text = lines[i]!.slice(column);
            if (/^-( |$)/.test(text)) fail(`Line ${number} starts a list item among keys. Put the list under a key.`, number);
            if (/^\?( |$)/.test(text)) fail(`Line ${number} uses a complex key (?), which this converter does not read.`, number);
            refuseSigns(text, number);
            const found = keyAt(i, column);
            if (!found) fail(`Line ${number} should be a key and its value, written as key: value.`, number);
            const { key, after } = found!;
            if (key === "<<") fail(`Line ${number} uses a merge key (<<), which this converter does not read. Write the keys out in full.`, number);
            const before = seen.get(key);
            if (before !== undefined) fail(`The key "${key}" is given twice, on lines ${before} and ${number}.`, number);
            seen.set(key, number);
            const rest = lines[i]!.slice(after);
            const start = after + /^[ \t]*/.exec(rest)![0].length;
            let item: Value;
            if (/^[ \t]*(#.*)?$/.test(rest)) {
                i++;
                skip();
                if (i < lines.length && !(column === 0 && marker(lines[i]!)) && indentOf(i) === column && /^-( |$)/.test(lines[i]!.slice(column))) item = list(column);
                else item = below(column);
            } else item = inline(start, column);
            put(table, key, item);
        }
        return table;
    }

    /** A block list whose dashes stand at a column. */
    function list(column: number): Value[] {
        const items: Value[] = [];
        for (;;) {
            skip();
            if (i >= lines.length || (column === 0 && marker(lines[i]!))) break;
            const indent = indentOf(i);
            if (indent < column) break;
            const number = i + 1;
            if (indent > column) fail(`Line ${number} is indented more than the list items around it.`, number);
            const text = lines[i]!.slice(column);
            if (!/^-( |$)/.test(text)) break;
            const after = text.slice(1);
            const spaces = /^[ ]*/.exec(after)![0].length;
            const content = after.slice(spaces);
            if (content === "" || content.startsWith("#")) {
                i++;
                items.push(below(column));
                continue;
            }
            if (content[0] === "\t") fail(`Line ${number} is indented with a tab. YAML allows only spaces there.`, number);
            // the item's own node starts after the dash, as if the dash were a space
            const line = lines[i]!;
            lines[i] = `${line.slice(0, column)} ${line.slice(column + 1)}`;
            items.push(at(column + 1 + spaces, column));
        }
        return items;
    }

    skip();
    if (i < lines.length && lines[i]!.startsWith("%")) fail(`Line ${i + 1} is a directive (%), which this converter does not read.`, i + 1);
    if (i < lines.length && /^---(\s|$)/.test(lines[i]!)) {
        const rest = lines[i]!.slice(3);
        if (/^\s*(#.*)?$/.test(rest)) i++;
        else lines[i] = `   ${rest}`;
    }
    const value = below(-1);
    skip();
    if (i < lines.length) {
        const number = i + 1;
        if (/^\.\.\.(\s|$)/.test(lines[i]!)) {
            i++;
            skip();
            if (i >= lines.length) return value;
            fail(`Line ${i + 1} starts another document. This converter reads one document a file.`, i + 1);
        }
        if (/^---(\s|$)/.test(lines[i]!)) fail(`Line ${number} starts another document. This converter reads one document a file.`, number);
        fail(`Line ${number} is not understood here. Check its indentation.`, number);
    }
    return value;
}

// ---- writing ----

/** Whether a string must be written in quotes to read back as the same string. */
export function needsQuotes(text: string): boolean {
    if (text === "" || resolve(text) !== text) return true;
    if (/^\s|\s$/.test(text)) return true;
    if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.test(text)) return true;
    if (/: |:$| #|\t#/.test(text)) return true;
    if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return true;
    return /^(\.\.\.|---)/.test(text);
}

/** A string as YAML writes it on one line: plain where it can be, else in double quotes, whose escapes are JSON's and read the same. */
function scalar(value: Value): string {
    if (value === null) return "null";
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") {
        if (Number.isNaN(value)) return ".nan";
        if (value === Infinity) return ".inf";
        if (value === -Infinity) return "-.inf";
        return String(value);
    }
    const text = value as string;
    return needsQuotes(text) ? JSON.stringify(text) : text;
}

/** Whether a string goes out as a `|` block: it has line breaks and nothing a block cannot hold exactly. */
function asBlock(text: string): boolean {
    return text.includes("\n") && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\ufeff]/.test(text) && !text.split("\n").some((line) => line !== "" && /^\s+$/.test(line));
}

/** A `|` block: its header and its lines at an indentation. */
function blockLines(text: string, indent: number): { header: string; lines: string[] } {
    const trail = /\n*$/.exec(text)![0].length;
    const chomp = trail === 0 ? "-" : trail === 1 ? "" : "+";
    const body = trail === 0 ? text : text.slice(0, -1);
    const lines = body.split("\n");
    const first = lines.find((line) => line !== "") ?? "";
    const pad = " ".repeat(indent);
    return { header: `|${first.startsWith(" ") ? "2" : ""}${chomp}`, lines: lines.map((line) => (line === "" ? "" : pad + line)) };
}

const isTable = (value: Value): value is Table => typeof value === "object" && value !== null && !Array.isArray(value);
const empty = (value: Value) => (Array.isArray(value) ? value.length === 0 : isTable(value) && Object.keys(value).length === 0);

/** A value after a key or a dash: on the same line, or as a block of lines under it. */
function after(prefix: string, value: Value, indent: number): string[] {
    if (typeof value === "string" && asBlock(value)) {
        const made = blockLines(value, indent);
        return [`${prefix} ${made.header}`, ...made.lines];
    }
    if (empty(value)) return [`${prefix} ${Array.isArray(value) ? "[]" : "{}"}`];
    if (Array.isArray(value)) return [prefix, ...listLines(value, indent)];
    if (isTable(value)) return [prefix, ...tableLines(value, indent)];
    return [`${prefix} ${scalar(value)}`];
}

function tableLines(table: Table, indent: number): string[] {
    const pad = " ".repeat(indent);
    return Object.entries(table).flatMap(([key, value]) => after(`${pad}${scalar(key)}:`, value, indent + 2));
}

function listLines(items: Value[], indent: number): string[] {
    const pad = " ".repeat(indent);
    return items.flatMap((item) => {
        if ((isTable(item) || Array.isArray(item)) && !empty(item)) {
            // the first line of the item's own block goes after the dash
            const lines = isTable(item) ? tableLines(item, indent + 2) : listLines(item, indent + 2);
            lines[0] = `${pad}- ${lines[0]!.slice(indent + 2)}`;
            return lines;
        }
        return after(`${pad}-`, item, indent + 2);
    });
}

/** A value written as a YAML document, ending in a line break. */
export function writeYaml(value: Value): string {
    let lines: string[];
    if (isTable(value) && !empty(value)) lines = tableLines(value, 0);
    else if (Array.isArray(value) && !empty(value)) lines = listLines(value, 0);
    else if (typeof value === "string" && asBlock(value)) {
        const made = blockLines(value, 2);
        lines = [made.header, ...made.lines];
    } else lines = [empty(value) ? (Array.isArray(value) ? "[]" : "{}") : scalar(value)];
    return `${lines.join("\n")}\n`;
}
