// What the CSV reader and writer hold true: quotes, doubled quotes and line breaks inside fields, CR LF
// or LF, a byte order mark, the separator found or chosen, a quote never closed refused with its line, and
// rows written and read back the same.

import { expect, test } from "bun:test";
import { DataError } from "./errors";
import { findSeparator, readCsv, writeCsv } from "./csv";

test("fields in quotes may hold the separator, a doubled quote and a line break", () => {
    expect(readCsv('name,note\r\n"Smith, Jo","said ""hi""\r\nthen left"\r\n')).toEqual([
        ["name", "note"],
        ["Smith, Jo", 'said "hi"\r\nthen left'],
    ]);
});

test("LF alone, a byte order mark, empty fields and a last line with no ending are read", () => {
    expect(readCsv("\ufeffa,b,c\n1,,3\n,,\nx,y,z")).toEqual([
        ["a", "b", "c"],
        ["1", "", "3"],
        ["", "", ""],
        ["x", "y", "z"],
    ]);
});

test("empty lines are no rows", () => {
    expect(readCsv("a,b\n\n1,2\n\n")).toEqual([
        ["a", "b"],
        ["1", "2"],
    ]);
});

test("the separator is found: semicolon, tab and bar, and comma when nothing splits", () => {
    expect(findSeparator("a;b;c\n1;2,5;3\n4;5;6\n")).toBe(";");
    expect(findSeparator("a\tb\n1\t2\n")).toBe("\t");
    expect(findSeparator("a|b\n1|2\n")).toBe("|");
    expect(findSeparator("one\ntwo\n")).toBe(",");
    expect(readCsv("a;b\n1,5;2\n")).toEqual([
        ["a", "b"],
        ["1,5", "2"],
    ]);
});

test("a chosen separator is used even when another would split more", () => {
    expect(readCsv("a,b;c\n", ";")).toEqual([["a,b", "c"]]);
});

test("an unclosed quote is refused with the line it opened on", () => {
    let caught: unknown;
    try {
        readCsv('a,b\n1,"two\nthree\n');
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(DataError);
    expect((caught as DataError).message).toBe("A quote opened on line 2 is never closed.");
    expect((caught as DataError).line).toBe(2);
});

test("the writer quotes only where it must, ends lines in CR LF, and reads back the same", () => {
    const rows = [
        ["plain", "with, comma", 'a "quote"'],
        ["line\nbreak", " spaced ", ""],
    ];
    const text = writeCsv(rows);
    expect(text).toBe('plain,"with, comma","a ""quote"""\r\n"line\nbreak"," spaced ",\r\n');
    expect(readCsv(text)).toEqual(rows);
    expect(readCsv(writeCsv(rows, "\t"), "\t")).toEqual(rows);
});
