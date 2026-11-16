// CSV read and written by hand, as RFC 4180 describes it: fields split by a separator, a field in
// double quotes may hold the separator, a line break or a quote written twice. A byte order mark at
// the start is left out, and lines may end in CR LF or LF alone. The separator is chosen, or found:
// of comma, semicolon, tab and bar, the one that splits the most rows into the same number of fields.
//
//   readCsv("a,b\r\n1,2\r\n");             gives [["a", "b"], ["1", "2"]]
//   writeCsv([["a", "b"], ["1", "2"]]);    gives "a,b\r\n1,2\r\n"

import { DataError } from "./errors";

/** The separators a CSV file may use. */
export type Separator = "," | ";" | "\t" | "|";

/** The separators tried, in the order a tie is settled. */
export const SEPARATORS: Separator[] = [",", ";", "\t", "|"];

/** The rows of a CSV text split by one separator, each a list of fields; an unclosed quote is refused with its line. */
export function readCsv(text: string, separator?: Separator): string[][] {
    const body = text.startsWith("\ufeff") ? text.slice(1) : text;
    const by = separator ?? findSeparator(body);
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let at = 0;
    let line = 1;
    // a field that has started: so that "a," ends in two fields and an empty line is no row at all
    let started = false;
    while (at < body.length) {
        const char = body[at]!;
        if (char === '"' && field === "") {
            const opened = line;
            at++;
            let value = "";
            for (;;) {
                if (at >= body.length) throw new DataError(`A quote opened on line ${opened} is never closed.`, { line: opened });
                const inside = body[at]!;
                if (inside === '"') {
                    if (body[at + 1] === '"') {
                        value += '"';
                        at += 2;
                        continue;
                    }
                    at++;
                    break;
                }
                if (inside === "\n") line++;
                value += inside;
                at++;
            }
            field = value;
            started = true;
            // anything between the closing quote and the separator is kept, as most readers do
            while (at < body.length && body[at] !== by && body[at] !== "\n" && body[at] !== "\r") field += body[at++];
            continue;
        }
        if (char === by) {
            row.push(field);
            field = "";
            started = true;
            at++;
            continue;
        }
        if (char === "\r" || char === "\n") {
            if (started || field !== "") {
                row.push(field);
                rows.push(row);
            }
            row = [];
            field = "";
            started = false;
            at += char === "\r" && body[at + 1] === "\n" ? 2 : 1;
            line++;
            continue;
        }
        field += char;
        started = true;
        at++;
    }
    if (started || field !== "") {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

/** The separator that splits the most rows into the same number of fields (more than one), comma when none does. */
export function findSeparator(text: string): Separator {
    const sample = text.slice(0, 64 * 1024);
    let best: Separator = ",";
    let score = 0;
    for (const each of SEPARATORS) {
        let rows: string[][];
        try {
            rows = readCsv(sample, each);
        } catch {
            continue;
        }
        // the last row of a sample cut short may be broken, so it is left out of the count
        if (sample.length < text.length) rows = rows.slice(0, -1);
        const counts = new Map<number, number>();
        for (const row of rows) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
        let found = 0;
        for (const [width, many] of counts) if (width > 1 && many > found) found = many;
        if (found > score) {
            score = found;
            best = each;
        }
    }
    return best;
}

/** One field as CSV writes it: in quotes only when it holds the separator, a quote, a line break or spaces at an end. */
function field(value: string, separator: Separator): string {
    if (value.includes(separator) || /["\r\n]/.test(value) || /^\s|\s$/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
}

/** Rows written as CSV text. Lines end in CR LF, as RFC 4180 says, and the last line ends too. */
export function writeCsv(rows: string[][], separator: Separator = ","): string {
    return rows.map((row) => `${row.map((value) => field(value, separator)).join(separator)}\r\n`).join("");
}
