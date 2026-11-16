// What converting between CSV, JSON, YAML and TOML holds true: each pair goes there and back with its
// value kept; CSV values stay text unless numbers are asked for, and a note says so; shapes that cannot
// be carried are refused in plain words with what can be done, and doing it works.

import { expect, test } from "bun:test";
import { convertData, DataError, flatten, jsonFault, readData, writeData, type DataFormat, type Value } from "./data";

const refused = (run: () => unknown): DataError => {
    try {
        run();
    } catch (error) {
        if (error instanceof DataError) return error;
        throw error;
    }
    throw new Error("converted without complaint");
};

const rows = 'name,age,note\nJo,41,"likes ""tea"", cake"\nSam,7,\n';

test("CSV into JSON gives rows of text, with a note that numbers stay text, and types when asked", () => {
    const made = convertData(rows, "csv", "json");
    expect(JSON.parse(made.text)).toEqual([
        { name: "Jo", age: "41", note: 'likes "tea", cake' },
        { name: "Sam", age: "7", note: "" },
    ]);
    expect(made.notes).toEqual(["Numbers from the CSV are kept as text, since CSV does not say which values are numbers."]);
    expect(JSON.parse(convertData(rows, "csv", "json", { types: true }).text)).toEqual([
        { name: "Jo", age: 41, note: 'likes "tea", cake' },
        { name: "Sam", age: 7, note: null },
    ]);
    expect(JSON.parse(convertData("a;b\n1;2\n", "csv", "json", { header: false }).text)).toEqual([
        ["a", "b"],
        ["1", "2"],
    ]);
});

test("every pair of formats goes there and back with the value kept", () => {
    const value: Value = { title: "Things", count: 3, ok: true, people: [{ name: "Jo", age: 41 }, { name: "Sam", age: 7 }], tags: ["a", "b"], owner: { name: "Ana", city: "Here" } };
    const formats: DataFormat[] = ["json", "yaml", "toml"];
    for (const from of formats) {
        const start = writeData(value, from).text;
        for (const to of formats) {
            if (to === from) continue;
            const there = convertData(start, from, to).text;
            const back = convertData(there, to, from).text;
            expect({ from, to, value: readData(back, from).value }).toEqual({ from, to, value });
        }
    }
    // rows of text go through CSV and back unchanged
    const table: Value = [
        { name: "Jo", note: "line\nbreak, comma" },
        { name: "Sam", note: "" },
    ];
    for (const other of formats) {
        const csv = writeData(table, "csv").text;
        const there = convertData(csv, "csv", other, { wrap: "items" }).text;
        const back = convertData(there, other, "csv", { firstTable: true }).text;
        expect(readData(back, "csv").value).toEqual(table);
    }
});

test("nested data into CSV is refused with an offer to spread it, which works", () => {
    const nested = JSON.stringify([{ name: "Jo", address: { city: "Here", zip: "1" }, tags: ["a", "b"] }]);
    const error = refused(() => convertData(nested, "json", "csv"));
    expect(error.message).toBe('CSV holds one plain value in each field, and the column "address" holds nested data in row 1.');
    expect(error.offer).toEqual({ key: "flatten", words: "Spread nested values into columns named like address.city." });
    expect(convertData(nested, "json", "csv", { flatten: true }).text).toBe("name,address.city,address.zip,tags.0,tags.1\r\nJo,Here,1,a,b\r\n");
    expect(flatten({ a: { b: [1, { c: 2 }] }, e: [] })).toEqual({ "a.b.0": 1, "a.b.1.c": 2, e: "" });
});

test("rows with different keys go into CSV as the union of their columns, with a note", () => {
    const made = convertData(JSON.stringify([{ a: 1 }, { b: 2 }]), "json", "csv");
    expect(made.text).toBe("a,b\r\n1,\r\n,2\r\n");
    expect(made.notes).toEqual(["Rows without a value for a column have that field left empty."]);
});

test("a table holding a list of rows is refused for CSV with an offer to use the list, which works", () => {
    const toml = '[[items]]\nname = "Jo"\n[[items]]\nname = "Sam"\n';
    const error = refused(() => convertData(toml, "toml", "csv"));
    expect(error.message).toBe('CSV holds one list of rows, and this is a table with the list "items" inside it.');
    expect(error.offer?.key).toBe("first-table");
    expect(convertData(toml, "toml", "csv", { firstTable: true }).text).toBe("name\r\nJo\r\nSam\r\n");
    expect(refused(() => convertData("42", "json", "csv")).message).toBe("CSV holds rows and columns, and this is a single value.");
});

test("a list into TOML is refused with an offer to name it, which works; so is a single value", () => {
    const error = refused(() => convertData(rows, "csv", "toml"));
    expect(error.message).toBe("TOML needs named values at the top, and this is a list.");
    expect(error.offer).toEqual({ key: "wrap", words: "Put the list under the name items.", name: "items" });
    const made = convertData(rows, "csv", "toml", { wrap: "items" });
    expect(made.text).toBe('[[items]]\nname = "Jo"\nage = "41"\nnote = "likes \\"tea\\", cake"\n\n[[items]]\nname = "Sam"\nage = "7"\nnote = ""\n');
    expect(made.notes).toContain("Everything is put under the name items.");
    expect(refused(() => convertData("5", "json", "toml")).offer?.name).toBe("value");
});

test("null into TOML is refused with an offer to leave empty values out, which works", () => {
    const json = JSON.stringify({ a: 1, b: null, c: [1, null, 2], d: { e: null } });
    const error = refused(() => convertData(json, "json", "toml"));
    expect(error.message).toBe("TOML has no empty value, and there is one at b.");
    expect(error.offer?.key).toBe("drop-nulls");
    const made = convertData(json, "json", "toml", { dropNulls: true });
    expect(made.text).toBe("a = 1\nc = [1, 2]\n\n[d]\n");
    expect(made.notes).toEqual(["3 empty values are left out."]);
});

test("infinity and not-a-number from YAML or TOML are refused for JSON plainly", () => {
    expect(refused(() => convertData("a:\n  b: .inf\n", "yaml", "json")).message).toBe("JSON cannot hold infinity or not-a-number, and there is one at a.b.");
    expect(refused(() => convertData("x = [1, nan]\n", "toml", "json")).message).toBe("JSON cannot hold infinity or not-a-number, and there is one at x[1].");
});

test("TOML dates become text with a note; broken JSON is said with its line", () => {
    const made = convertData("when = 1979-05-27\n", "toml", "json");
    expect(JSON.parse(made.text)).toEqual({ when: "1979-05-27" });
    expect(made.notes).toEqual(["Dates and times are kept as text, since the other formats have no dates of their own."]);
    const broken = refused(() => convertData('{\n  "a": 1,\n  "b": }\n', "json", "yaml"));
    expect(broken.message).toBe("This is not valid JSON. The first problem is on line 3.");
    expect(broken.line).toBe(3);
    expect(refused(() => convertData('{"a": ', "json", "yaml")).message).toBe("This is not valid JSON: it ends before it is finished.");
    expect(jsonFault('[1, 2, "x\ty"]')).toBe(7);
    expect(jsonFault('{"a": [1, {"b": null}], "c": "\\u00e9"}')).toBeUndefined();
    expect(jsonFault("[1] 2")).toBe(4);
});

test("CSV with a name used twice or a row too long is refused with an offer to read the first row as data", () => {
    const twice = refused(() => convertData("a,a\n1,2\n", "csv", "json"));
    expect(twice.message).toBe('The column name "a" is used twice. Rename one, or read the file without a row of names.');
    expect(twice.offer?.key).toBe("no-header");
    expect(refused(() => convertData("a,b\n1,2,3\n", "csv", "json")).message).toBe("Row 2 has 3 fields, more than the 2 names in the first row.");
    const short = convertData("a,b,\n1\n", "csv", "json");
    expect(JSON.parse(short.text)).toEqual([{ a: "1", b: "", "column 3": "" }]);
    expect(short.notes).toEqual(["Numbers from the CSV are kept as text, since CSV does not say which values are numbers.", "Columns with no name are named by their place, such as column 3.", "Row 2 and any others with fewer fields than names have the rest left empty."]);
});
