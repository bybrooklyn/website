// TOML 1.0 read and written by hand. Read: keys bare, quoted and dotted; basic, literal and multi-line
// strings with their escapes; integers with `_` and in hex, octal and binary; floats with `inf` and
// `nan`; true and false; arrays across lines; inline tables; `[table]` and `[[array of tables]]` headers. A key
// or a table defined twice is refused with its line. Dates and times (offset and local date-times,
// dates, times) are kept as their text, so they become strings in every other format, and the reader
// says so. Integers past 2^53 lose their last digits, as JavaScript's numbers do.
//
// Written: the top must be a table; in each table its plain values first, then its tables as
// `[a.b]` and its lists of tables as `[[a]]`, other lists inline. TOML has no null, so one is refused.
// Keys are quoted only where a bare key cannot hold them.
//
//   readToml('title = "x"\n');   gives { value: { title: "x" }, dates: false }
//   writeToml({ title: "x" });    gives 'title = "x"\n'

import { DataError } from "./errors";
import type { Value } from "./data";
import { put } from "./yaml";

type Table = { [key: string]: Value };

const DATE = /^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?$/;
const TIME = /^\d{2}:\d{2}:\d{2}(\.\d+)?$/;
const DIGITS = /^[+-]?(0|[1-9](_?\d)*)$/;
const FLOAT = /^[+-]?(0|[1-9](_?\d)*)(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;

/** Reads a TOML document into a table, and says whether it held dates or times (kept as text). Throws a DataError with its line. */
export function readToml(text: string): { value: Table; dates: boolean } {
    const source = text.replace(/^\ufeff/, "").replace(/\r\n/g, "\n");
    let pos = 0;
    let dates = false;
    const lineOf = (at: number) => source.slice(0, at).split("\n").length;
    const fail = (message: string, at = pos): never => {
        const line = lineOf(at);
        throw new DataError(message.replace("{line}", String(line)), { line });
    };
    const root: Table = {};
    // tables made by a header, made along the way by a deeper header, made by dotted keys, written inline, and lists of tables
    const headed = new WeakSet<Table>();
    const dotted = new WeakSet<Table>();
    const inline = new WeakSet<object>();
    const listed = new WeakSet<Value[]>();
    let current = root;

    const spaces = () => {
        while (source[pos] === " " || source[pos] === "\t") pos++;
    };
    const comment = () => {
        if (source[pos] === "#") while (pos < source.length && source[pos] !== "\n") pos++;
    };
    /** Spaces, line breaks and comments, as inside an array. */
    const gaps = () => {
        for (;;) {
            spaces();
            comment();
            if (source[pos] === "\n" || (source[pos] === "\r" && source[pos + 1] === "\n")) pos++;
            else return;
        }
    };
    const lineEnd = () => {
        spaces();
        comment();
        if (pos < source.length && source[pos] !== "\n") fail("Line {line} has something after its value that is not understood.");
    };

    /** One key: bare, or quoted in either kind of quotes. */
    const keyPart = (): string => {
        if (source[pos] === '"' || source[pos] === "'") {
            if (source.startsWith(source[pos]!.repeat(3), pos)) fail("Line {line} has a key in triple quotes, which TOML does not allow.");
            return stringValue();
        }
        const bare = /^[A-Za-z0-9_-]+/.exec(source.slice(pos, pos + 256))?.[0];
        if (!bare) fail("Line {line} is missing a key here.");
        pos += bare!.length;
        return bare!;
    };
    const keyPath = (): string[] => {
        const path: string[] = [];
        for (;;) {
            spaces();
            path.push(keyPart());
            spaces();
            if (source[pos] !== ".") return path;
            pos++;
        }
    };

    /** A string of any of the four kinds, its escapes read. */
    const stringValue = (): string => {
        const quote = source[pos]!;
        const triple = source.startsWith(quote.repeat(3), pos);
        const start = pos;
        pos += triple ? 3 : 1;
        if (triple && source[pos] === "\n") pos++;
        let out = "";
        for (;;) {
            const char = source[pos];
            if (char === undefined || (!triple && char === "\n")) fail("A string that opens on line {line} is never closed.", start);
            if (char === quote) {
                if (!triple) {
                    pos++;
                    return out;
                }
                if (source.startsWith(quote.repeat(3), pos)) {
                    // up to two quotes may stand just before the closing three
                    let run = 0;
                    while (source[pos + run] === quote) run++;
                    if (run > 5) fail("Line {line} has too many quotes in a row.");
                    out += quote.repeat(run - 3);
                    pos += run;
                    return out;
                }
            }
            if (char === "\\" && quote === '"') {
                const sign = source[pos + 1];
                if (triple && /[ \t\n]/.test(sign ?? "")) {
                    // a backslash at the end of a line joins it to the next, leaving out the spaces between
                    let look = pos + 1;
                    while (source[look] === " " || source[look] === "\t") look++;
                    if (source[look] === "\n") {
                        pos = look;
                        while (/[ \t\n]/.test(source[pos] ?? "")) pos++;
                        continue;
                    }
                }
                const simple: Record<string, string> = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
                if (sign !== undefined && simple[sign] !== undefined) {
                    out += simple[sign];
                    pos += 2;
                    continue;
                }
                if (sign === "u" || sign === "U") {
                    const size = sign === "u" ? 4 : 8;
                    const digits = source.slice(pos + 2, pos + 2 + size);
                    if (!new RegExp(`^[0-9a-fA-F]{${size}}$`).test(digits)) fail(`Line {line} has an escape \\${sign} without its ${size} hex digits.`);
                    const code = parseInt(digits, 16);
                    if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) fail("Line {line} has an escape for a character that does not exist.");
                    out += String.fromCodePoint(code);
                    pos += 2 + size;
                    continue;
                }
                fail(`Line {line} has an escape \\${sign ?? ""} that TOML does not have.`);
            }
            if (char !== "\t" && char !== "\n" && (char! < " " || char === "\x7f")) fail("Line {line} has a control character in a string. Write it as an escape.");
            out += char;
            pos++;
        }
    };

    /** A value: a string, a number, a boolean, a date, an array or an inline table. */
    const value = (): Value => {
        const char = source[pos];
        if (char === '"' || char === "'") return stringValue();
        if (char === "[") {
            const opened = pos;
            pos++;
            const items: Value[] = [];
            for (;;) {
                gaps();
                if (source[pos] === "]") {
                    pos++;
                    return items;
                }
                if (pos >= source.length) fail("An array that opens on line {line} is never closed.", opened);
                items.push(value());
                gaps();
                if (pos >= source.length) fail("An array that opens on line {line} is never closed.", opened);
                if (source[pos] === ",") pos++;
                else if (source[pos] !== "]") fail("Line {line} needs a comma or a ] here.");
            }
        }
        if (char === "{") {
            pos++;
            const table: Table = {};
            spaces();
            if (source[pos] === "}") {
                pos++;
                inline.add(table);
                return table;
            }
            for (;;) {
                const path = keyPath();
                if (source[pos] !== "=") fail("Line {line} needs an = after the key.");
                pos++;
                spaces();
                set(table, path, value(), true);
                spaces();
                if (source[pos] === ",") {
                    pos++;
                    spaces();
                    if (source[pos] === "}") fail("Line {line} has a comma before }, which TOML does not allow in an inline table.");
                    continue;
                }
                if (source[pos] === "}") {
                    pos++;
                    inline.add(table);
                    return table;
                }
                fail("Line {line} needs a comma or a } here. An inline table stays on one line.");
            }
        }
        // a bare word: read to the next space, comma, bracket or comment; a date may hold one space before its time
        let word = /^[^\s,\]}#]+/.exec(source.slice(pos, pos + 128))?.[0] ?? "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(word) && / \d{2}:\d{2}:\d{2}/.test(source.slice(pos + word.length, pos + word.length + 9))) word += /^ [^\s,\]}#]+/.exec(source.slice(pos + word.length))![0];
        if (!word) fail("Line {line} is missing a value here.");
        const at = pos;
        pos += word.length;
        if (word === "true") return true;
        if (word === "false") return false;
        if (/^[+-]?inf$/.test(word)) return word.startsWith("-") ? -Infinity : Infinity;
        if (/^[+-]?nan$/.test(word)) return NaN;
        if (DIGITS.test(word)) return Number(word.replace(/_/g, ""));
        const based = /^0([xob])([0-9A-Fa-f](_?[0-9A-Fa-f])*)$/.exec(word);
        if (based) {
            const base = { x: 16, o: 8, b: 2 }[based[1] as "x" | "o" | "b"];
            const digits = based[2]!.replace(/_/g, "");
            if (![...digits].every((digit) => parseInt(digit, 16) < base)) fail(`Line {line} has a number, ${word}, that is not understood.`, at);
            return parseInt(digits, base);
        }
        if (FLOAT.test(word) && /[.eE]/.test(word)) return Number(word.replace(/_/g, ""));
        if (DATE.test(word) || TIME.test(word)) {
            dates = true;
            return word;
        }
        return fail(`Line {line} has a value, ${word}, that is not understood. Text goes in quotes.`, at);
    };

    /** Sets a dotted key in a table, making the tables along the way, refusing what is set already. */
    function set(table: Table, path: string[], item: Value, inInline = false) {
        let here = table;
        for (const part of path.slice(0, -1)) {
            const found = Object.hasOwn(here, part) ? here[part] : undefined;
            if (found === undefined) {
                const made: Table = {};
                dotted.add(made);
                put(here, part, made);
                here = made;
            } else if (typeof found === "object" && found !== null && !Array.isArray(found) && !inline.has(found) && (!headed.has(found) || inInline)) here = found;
            else return fail(`Line {line} sets a key under "${part}", which is already defined.`);
        }
        const last = path[path.length - 1]!;
        if (Object.hasOwn(here, last)) fail(`Line {line} sets the key "${path.join(".")}" a second time.`);
        put(here, last, item);
    }

    /** The table a header names, walking through the tables along the way and into the last of each list of tables. */
    function walk(path: string[]): Table {
        let here = root;
        for (const part of path) {
            const found = Object.hasOwn(here, part) ? here[part] : undefined;
            if (found === undefined) {
                const made: Table = {};
                put(here, part, made);
                here = made;
            } else if (Array.isArray(found) && listed.has(found)) here = found[found.length - 1] as Table;
            else if (typeof found === "object" && found !== null && !Array.isArray(found) && !inline.has(found)) here = found;
            else return fail(`Line {line} names a table under "${part}", which is already a value.`);
        }
        return here;
    }

    for (;;) {
        gaps();
        if (pos >= source.length) break;
        if (source[pos] === "[") {
            const many = source[pos + 1] === "[";
            pos += many ? 2 : 1;
            const path = keyPath();
            if (!source.startsWith(many ? "]]" : "]", pos)) fail(`Line {line} needs ${many ? "]]" : "]"} to close its header.`);
            pos += many ? 2 : 1;
            lineEnd();
            const parent = walk(path.slice(0, -1));
            const last = path[path.length - 1]!;
            const found = Object.hasOwn(parent, last) ? parent[last] : undefined;
            if (many) {
                if (found === undefined) {
                    const list: Value[] = [];
                    listed.add(list);
                    put(parent, last, list);
                    current = {};
                    list.push(current);
                } else if (Array.isArray(found) && listed.has(found)) {
                    current = {};
                    found.push(current);
                } else fail(`Line {line} makes "${path.join(".")}" a list of tables, but it is already defined as something else.`);
            } else {
                if (found === undefined) {
                    current = {};
                    put(parent, last, current);
                } else if (typeof found === "object" && found !== null && !Array.isArray(found) && !headed.has(found) && !dotted.has(found) && !inline.has(found)) current = found;
                else fail(`Line {line} defines the table "${path.join(".")}" a second time.`);
                headed.add(current);
            }
            continue;
        }
        const start = pos;
        const path = keyPath();
        if (source[pos] !== "=") fail("Line {line} should be a key and its value, written as key = value.", start);
        pos++;
        spaces();
        set(current, path, value());
        lineEnd();
    }
    return { value: root, dates };
}

// ---- writing ----

/** A string as a TOML basic string, every character that must be escaped escaped. */
export function tomlString(text: string): string {
    const named: Record<string, string> = { "\b": "\\b", "\t": "\\t", "\n": "\\n", "\f": "\\f", "\r": "\\r", '"': '\\"', "\\": "\\\\" };
    return `"${text.replace(/[\u0000-\u001f"\\\u007f]/g, (char) => named[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)}"`;
}

/** A key as TOML writes it: bare where it can be, else quoted. */
export function tomlKey(key: string): string {
    return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

const isTable = (value: Value): value is Table => typeof value === "object" && value !== null && !Array.isArray(value);
const tablesOnly = (value: Value): value is Table[] => Array.isArray(value) && value.length > 0 && value.every(isTable);

/** A value written on one line: a string, number, boolean, inline array or inline table. Null is refused. */
function inlineValue(value: Value, where: string): string {
    if (value === null) throw new DataError(`TOML has no empty value, and there is one at ${where}.`, { offer: { key: "drop-nulls", words: "Leave out the empty values." } });
    if (typeof value === "string") return tomlString(value);
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") {
        if (Number.isNaN(value)) return "nan";
        if (value === Infinity) return "inf";
        if (value === -Infinity) return "-inf";
        return String(value);
    }
    if (Array.isArray(value)) return `[${value.map((item, index) => inlineValue(item, `${where}[${index}]`)).join(", ")}]`;
    const entries = Object.entries(value);
    return entries.length ? `{ ${entries.map(([key, item]) => `${tomlKey(key)} = ${inlineValue(item, `${where}.${key}`)}`).join(", ")} }` : "{}";
}

/** A table's lines under its header: plain values, then its tables, then its lists of tables. */
function tableLines(table: Table, path: string[], out: string[]) {
    const name = (key: string) => [...path, key].map(tomlKey).join(".");
    const where = (key: string) => [...path, key].join(".");
    for (const [key, value] of Object.entries(table)) if (!isTable(value) && !tablesOnly(value)) out.push(`${tomlKey(key)} = ${inlineValue(value, where(key))}`);
    for (const [key, value] of Object.entries(table)) {
        if (!isTable(value)) continue;
        if (out.length) out.push("");
        out.push(`[${name(key)}]`);
        tableLines(value, [...path, key], out);
    }
    for (const [key, value] of Object.entries(table)) {
        if (!tablesOnly(value)) continue;
        for (const item of value) {
            if (out.length) out.push("");
            out.push(`[[${name(key)}]]`);
            tableLines(item, [...path, key], out);
        }
    }
}

/** A table written as a TOML document, ending in a line break. */
export function writeToml(table: Table): string {
    const out: string[] = [];
    tableLines(table, [], out);
    return out.length ? `${out.join("\n")}\n` : "";
}
