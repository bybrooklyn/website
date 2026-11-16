// CSV, JSON, YAML and TOML into each other. Each is read into one plain value (null, a boolean, a
// number, a string, a list or a table) and written out of it. Where a shape cannot be carried, a
// DataError says why in plain words and offers what can be done: nested data into CSV can be spread
// into columns named like `a.b`; a list into TOML can be put under one name; TOML's missing null can
// be met by leaving the empty values out; a table holding a list of rows can give those rows to CSV.
// JSON is read and written by the browser's own JSON.
//
//   `convertData("a,b\n1,2\n", "csv", "json")` gives `{ text, notes }`

import { readCsv, writeCsv, findSeparator, type Separator } from "./csv";
import { DataError } from "./errors";
import { readToml, writeToml } from "./toml";
import { put, readYaml, writeYaml } from "./yaml";

export { DataError } from "./errors";

/** A plain value, as every one of these formats can be read into. */
export type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

/** The data formats. */
export type DataFormat = "csv" | "json" | "yaml" | "toml";

/** The choices a conversion takes. */
export interface DataOptions {
    /** The CSV separator; found by itself when absent. */
    separator?: Separator;
    /** Whether the first CSV row is the names of the columns; true when absent. */
    header?: boolean;
    /** Whether plain numbers, true, false and empty CSV fields are read as such, instead of as text. */
    types?: boolean;
    /** Whether nested values going into CSV are spread into columns named like `a.b` and `a.0`. */
    flatten?: boolean;
    /** A name a list or a single value is put under, for TOML, which needs names at the top. */
    wrap?: string;
    /** Whether empty values are left out, for TOML, which has none. */
    dropNulls?: boolean;
    /** Whether the first list of rows inside a table is what goes into CSV. */
    firstTable?: boolean;
}

type Table = { [key: string]: Value };
const isTable = (value: Value): value is Table => typeof value === "object" && value !== null && !Array.isArray(value);
const isScalar = (value: Value) => value === null || typeof value !== "object";

/** A CSV field read as a number, a boolean or null where it is plainly one. */
function typed(field: string): Value {
    if (field === "") return null;
    if (field === "true") return true;
    if (field === "false") return false;
    if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/.test(field)) return Number(field);
    return field;
}

/** A CSV text read into rows of named values (or plain lists of fields without a header row). */
function fromCsv(text: string, options: DataOptions, notes: string[]): Value {
    const separator = options.separator ?? findSeparator(text.replace(/^\ufeff/, ""));
    const rows = readCsv(text, separator);
    const cell = (field: string) => (options.types ? typed(field) : field);
    if (!options.types && rows.slice(options.header === false ? 0 : 1).some((row) => row.some((field) => /^-?\d+(\.\d+)?$/.test(field)))) notes.push("Numbers from the CSV are kept as text, since CSV does not say which values are numbers.");
    if (options.header === false) return rows.map((row) => row.map(cell));
    const [names, ...body] = rows;
    if (!names) return [];
    const seen = new Set<string>();
    names.forEach((name, index) => {
        if (seen.has(name)) throw new DataError(`The column name "${name}" is used twice. Rename one, or read the file without a row of names.`, { offer: { key: "no-header", words: "Read the first row as data." } });
        if (name === "") names[index] = `column ${index + 1}`;
        seen.add(names[index]!);
    });
    if (names.some((name, index) => name === `column ${index + 1}`)) notes.push("Columns with no name are named by their place, such as column 3.");
    let short = 0;
    return body.map((row, index) => {
        if (row.length > names.length) throw new DataError(`Row ${index + 2} has ${row.length} fields, more than the ${names.length} names in the first row.`, { offer: { key: "no-header", words: "Read the first row as data." } });
        if (row.length < names.length && short++ === 0) notes.push(`Row ${index + 2} and any others with fewer fields than names have the rest left empty.`);
        const record: Table = {};
        names.forEach((name, column) => put(record, name, row[column] === undefined ? (options.types ? null : "") : cell(row[column]!)));
        return record;
    });
}

/** Where a JSON text first goes wrong, found by walking it, since each browser words JSON's errors differently and not all give the place. */
export function jsonFault(text: string): number | undefined {
    let pos = 0;
    const space = () => {
        while (/[ \t\n\r]/.test(text[pos] ?? "")) pos++;
    };
    const value = (): boolean => {
        space();
        const char = text[pos];
        if (char === "{" || char === "[") {
            const close = char === "{" ? "}" : "]";
            pos++;
            space();
            if (text[pos] === close) return (pos++, true);
            for (;;) {
                if (char === "{") {
                    space();
                    if (text[pos] !== '"' || !value()) return false;
                    space();
                    if (text[pos] !== ":") return false;
                    pos++;
                }
                if (!value()) return false;
                space();
                if (text[pos] === ",") pos++;
                else if (text[pos] === close) return (pos++, true);
                else return false;
            }
        }
        if (char === '"') {
            const found = /^"(?:[^"\\\u0000-\u001f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/.exec(text.slice(pos));
            if (!found) return false;
            pos += found[0].length;
            return true;
        }
        const word = /^(-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?|true|false|null)/.exec(text.slice(pos, pos + 400));
        if (!word) return false;
        pos += word[0].length;
        return true;
    };
    if (!value()) return pos;
    space();
    return pos < text.length ? pos : undefined;
}

/** JSON read by the browser, its error put in plain words with the line where it first goes wrong. */
function fromJson(text: string): Value {
    const body = text.replace(/^﻿/, "");
    try {
        return JSON.parse(body) as Value;
    } catch {
        const at = jsonFault(body);
        if (at === undefined || at >= body.trimEnd().length) throw new DataError("This is not valid JSON: it ends before it is finished.");
        const line = body.slice(0, at).split("\n").length;
        throw new DataError(`This is not valid JSON. The first problem is on line ${line}.`, { line });
    }
}

/** Reads a text in a format into a value, with notes on what changed on the way. */
export function readData(text: string, from: DataFormat, options: DataOptions = {}): { value: Value; notes: string[] } {
    const notes: string[] = [];
    if (from === "csv") return { value: fromCsv(text, options, notes), notes };
    if (from === "json") return { value: fromJson(text), notes };
    if (from === "yaml") return { value: readYaml(text), notes };
    const { value, dates } = readToml(text);
    if (dates) notes.push("Dates and times are kept as text, since the other formats have no dates of their own.");
    return { value, notes };
}

/** Where a value sits, as a path a person can find: `owner.name`, `items[2]`. */
const placed = (path: string, key: string | number) => (typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key);

/** The first place a value holds a null, or undefined. */
function nullAt(value: Value, path = ""): string | undefined {
    if (value === null) return path || "the top";
    if (Array.isArray(value)) for (const [index, item] of value.entries()) {
        const found = nullAt(item, placed(path, index));
        if (found) return found;
    }
    else if (isTable(value)) for (const [key, item] of Object.entries(value)) {
        const found = nullAt(item, placed(path, key));
        if (found) return found;
    }
    return undefined;
}

/** The first place a value holds infinity or not-a-number, which JSON cannot hold, or undefined. */
function infiniteAt(value: Value, path = ""): string | undefined {
    if (typeof value === "number" && !Number.isFinite(value)) return path || "the top";
    if (Array.isArray(value)) for (const [index, item] of value.entries()) {
        const found = infiniteAt(item, placed(path, index));
        if (found) return found;
    }
    else if (isTable(value)) for (const [key, item] of Object.entries(value)) {
        const found = infiniteAt(item, placed(path, key));
        if (found) return found;
    }
    return undefined;
}

/** A value with its empty values left out, and how many went. */
function withoutNulls(value: Value, count = { left: 0 }): Value {
    if (Array.isArray(value)) return value.filter((item) => (item === null ? (count.left++, false) : true)).map((item) => withoutNulls(item, count));
    if (isTable(value)) {
        const out: Table = {};
        for (const [key, item] of Object.entries(value)) {
            if (item === null) count.left++;
            else put(out, key, withoutNulls(item, count));
        }
        return out;
    }
    return value;
}

/** A table spread into one level, nested keys joined by dots and list places by their numbers. */
export function flatten(value: Value, prefix = "", out: Table = {}): Table {
    if (Array.isArray(value) || isTable(value)) {
        const entries: [string, Value][] = Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value);
        if (!entries.length && prefix) put(out, prefix, "");
        for (const [key, item] of entries) flatten(item, prefix ? `${prefix}.${key}` : key, out);
    } else put(out, prefix || "value", value);
    return out;
}

/** A plain value as a CSV field. */
const field = (value: Value) => (value === null ? "" : String(value));

/** A value written as CSV, or a DataError saying why its shape does not fit rows and columns. */
function toCsv(value: Value, options: DataOptions, notes: string[]): string {
    const separator = options.separator ?? ",";
    const flattenOffer = { key: "flatten" as const, words: "Spread nested values into columns named like address.city." };
    if (isScalar(value)) throw new DataError("CSV holds rows and columns, and this is a single value.");
    let rows: Value[];
    if (isTable(value)) {
        const lists = Object.entries(value).filter(([, item]) => Array.isArray(item) && item.length > 0 && item.every(isTable));
        if (lists.length && options.firstTable) {
            rows = lists[0]![1] as Value[];
            if (lists.length > 1 || Object.keys(value).length > 1) notes.push(`Only the list named "${lists[0]![0]}" is written; everything else is left out.`);
        } else if (lists.length) throw new DataError(`CSV holds one list of rows, and this is a table with the list "${lists[0]![0]}" inside it.`, { offer: { key: "first-table", words: `Write the list named "${lists[0]![0]}" as the rows.` } });
        else rows = [value];
    } else rows = value as Value[];
    if (!rows.length) return "";
    // a list of lists is rows of fields, with no row of names
    if (rows.every(Array.isArray)) {
        const fields = rows.map((row, index) =>
            (row as Value[]).map((item) => {
                if (!isScalar(item)) throw new DataError(`CSV holds one plain value in each field, and row ${index + 1} holds nested data.`);
                return field(item);
            }),
        );
        return writeCsv(fields, separator);
    }
    if (rows.every(isScalar)) {
        notes.push("A list of single values is written as one column named value.");
        return writeCsv([["value"], ...rows.map((item) => [field(item)])], separator);
    }
    if (!rows.every(isTable)) throw new DataError("CSV holds rows of the same kind, and this list mixes tables with other values.");
    const records = (rows as Table[]).map((row, index) => {
        if (options.flatten) return flatten(row);
        for (const [key, item] of Object.entries(row)) if (!isScalar(item)) throw new DataError(`CSV holds one plain value in each field, and the column "${key}" holds nested data in row ${index + 1}.`, { offer: flattenOffer });
        return row;
    });
    const names: string[] = [];
    const seen = new Set<string>();
    for (const record of records) for (const key of Object.keys(record)) if (!seen.has(key)) (seen.add(key), names.push(key));
    if (records.some((record) => Object.keys(record).length < names.length)) notes.push("Rows without a value for a column have that field left empty.");
    return writeCsv([names, ...records.map((record) => names.map((name) => (Object.hasOwn(record, name) ? field(record[name]!) : "")))], separator);
}

/** A value written in a format, or a DataError saying why it cannot be. */
export function writeData(value: Value, to: DataFormat, options: DataOptions = {}): { text: string; notes: string[] } {
    const notes: string[] = [];
    let given = value;
    if (options.dropNulls) {
        const count = { left: 0 };
        given = withoutNulls(given, count);
        if (count.left) notes.push(count.left === 1 ? "One empty value is left out." : `${count.left} empty values are left out.`);
    }
    if (to === "json") {
        const where = infiniteAt(given);
        if (where) throw new DataError(`JSON cannot hold infinity or not-a-number, and there is one at ${where}.`);
        return { text: `${JSON.stringify(given, null, 2)}\n`, notes };
    }
    if (to === "yaml") return { text: writeYaml(given), notes };
    if (to === "csv") return { text: toCsv(given, options, notes), notes };
    if (!isTable(given)) {
        const name = options.wrap;
        if (!name) {
            const words = Array.isArray(given) ? "TOML needs named values at the top, and this is a list." : "TOML needs named values at the top, and this is a single value.";
            throw new DataError(words, { offer: Array.isArray(given) ? { key: "wrap", words: "Put the list under the name items.", name: "items" } : { key: "wrap", words: "Put the value under the name value.", name: "value" } });
        }
        const wrapped: Table = {};
        put(wrapped, name, given);
        given = wrapped;
        notes.push(`Everything is put under the name ${name}.`);
    }
    const where = nullAt(given);
    if (where) throw new DataError(`TOML has no empty value, and there is one at ${where}.`, { offer: { key: "drop-nulls", words: "Leave out the empty values." } });
    return { text: writeToml(given as Table), notes };
}

/** Converts a text from one data format to another, with notes on what changed on the way. */
export function convertData(text: string, from: DataFormat, to: DataFormat, options: DataOptions = {}): { text: string; notes: string[] } {
    const read = readData(text, from, options);
    const written = writeData(read.value, to, options);
    return { text: written.text, notes: [...read.notes, ...written.notes] };
}
