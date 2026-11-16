// What the TOML reader and writer hold true: keys of every kind, the four kinds of string with their
// escapes, numbers in every base, dates kept as text, arrays and inline tables, tables and lists of
// tables; a key or table defined twice refused with its line; and any table written and read back the same.

import { expect, test } from "bun:test";
import { DataError } from "./errors";
import { readToml, tomlKey, writeToml } from "./toml";
import type { Value } from "./data";

const refused = (text: string): DataError => {
    try {
        readToml(text);
    } catch (error) {
        if (error instanceof DataError) return error;
        throw error;
    }
    throw new Error(`read without complaint: ${text}`);
};

test("keys bare, quoted and dotted, and the four kinds of string", () => {
    const text = [
        'bare_key-1 = "basic \\t \\"q\\" \\u00e9 \\U0001F600"',
        "\"quoted key\" = 'literal \\n stays'",
        "a.b . c = 1",
        'ml = """',
        'one',
        'two \\',
        '   three"""',
        "lit = '''",
        "raw \\n",
        "'''",
        'quotes = """""two quotes"""""',
    ].join("\n");
    expect(readToml(text).value).toEqual({
        "bare_key-1": 'basic \t "q" é 😀',
        "quoted key": "literal \\n stays",
        a: { b: { c: 1 } },
        ml: "one\ntwo three",
        lit: "raw \\n\n",
        quotes: '""two quotes""',
    });
});

test("numbers in every base and form, booleans, and dates kept as text with a note", () => {
    const read = readToml("a = +99\nb = 1_000\nc = 0xDEAD_beef\nd = 0o755\ne = 0b1101\nf = 3.14\ng = -2E-2\nh = 6.626e-34\ni = inf\nj = -inf\nk = nan\nl = true\nm = 1979-05-27T07:32:00Z\nn = 1979-05-27 07:32:00.5-07:00\no = 1979-05-27\np = 07:32:00\n");
    expect(read.value).toEqual({ a: 99, b: 1000, c: 0xdeadbeef, d: 0o755, e: 13, f: 3.14, g: -0.02, h: 6.626e-34, i: Infinity, j: -Infinity, k: NaN, l: true, m: "1979-05-27T07:32:00Z", n: "1979-05-27 07:32:00.5-07:00", o: "1979-05-27", p: "07:32:00" });
    expect(read.dates).toBe(true);
    expect(readToml("a = 1\n").dates).toBe(false);
});

test("arrays across lines with comments, inline tables, tables and lists of tables", () => {
    const text = `# top
title = "x" # after
list = [
  1, # one
  [2, "three"],
  { four = 4 },
]
point = { x = 1, y.z = 2 }

[owner]
name = "Jo"

[owner.address]
city = "Here"

[[fruit]]
name = "apple"
[fruit.physical]
color = "red"
[[fruit.variety]]
name = "fuji"

[[fruit]]
name = "plum"
`;
    expect(readToml(text).value).toEqual({
        title: "x",
        list: [1, [2, "three"], { four: 4 }],
        point: { x: 1, y: { z: 2 } },
        owner: { name: "Jo", address: { city: "Here" } },
        fruit: [{ name: "apple", physical: { color: "red" }, variety: [{ name: "fuji" }] }, { name: "plum" }],
    });
    expect(readToml("[a.b]\nc = 1\n[a]\nd = 2\n").value).toEqual({ a: { b: { c: 1 }, d: 2 } });
});

test("a key or a table defined twice is refused with its line", () => {
    expect(refused("a = 1\na = 2\n").message).toBe('Line 2 sets the key "a" a second time.');
    expect(refused("[t]\nx = 1\n[t]\ny = 2\n").message).toBe('Line 3 defines the table "t" a second time.');
    expect(refused("[t]\nx.y = 1\n[t.x]\n").line).toBe(3);
    expect(refused("a = { b = 1 }\n[a]\n").line).toBe(2);
    expect(refused("a = { b = 1 }\na.c = 2\n").message).toBe('Line 2 sets a key under "a", which is already defined.');
    expect(refused("a = [1]\n[[a]]\n").message).toBe('Line 2 makes "a" a list of tables, but it is already defined as something else.');
    expect(refused("a = 1\n[a.b]\n").message).toBe('Line 2 names a table under "a", which is already a value.');
});

test("broken text is refused plainly with its line", () => {
    expect(refused('a = "open\nb = 1\n').message).toBe("A string that opens on line 1 is never closed.");
    expect(refused("a = hello\n").message).toBe("Line 1 has a value, hello, that is not understood. Text goes in quotes.");
    expect(refused("a = 1 2\n").message).toBe("Line 1 has something after its value that is not understood.");
    expect(refused("words\n").message).toBe("Line 1 should be a key and its value, written as key = value.");
    expect(refused("a = { b = 1, }\n").message).toBe("Line 1 has a comma before }, which TOML does not allow in an inline table.");
    expect(refused('a = "\\q"\n').message).toBe("Line 1 has an escape \\q that TOML does not have.");
    expect(refused("a = [1, 2\n").message).toBe("An array that opens on line 1 is never closed.");
    expect(refused("[a\n").message).toBe("Line 1 needs ] to close its header.");
});

test("tables are written plain values first, then tables, then lists of tables, with keys quoted only where needed", () => {
    expect(tomlKey("plain-key_1")).toBe("plain-key_1");
    expect(tomlKey("with space")).toBe('"with space"');
    expect(writeToml({ name: "x", owner: { name: "Jo" }, fruit: [{ name: "apple" }, { name: "plum" }], tags: ["a", "b"], mixed: [1, { a: 1 }] })).toBe('name = "x"\ntags = ["a", "b"]\nmixed = [1, { a = 1 }]\n\n[owner]\nname = "Jo"\n\n[[fruit]]\nname = "apple"\n\n[[fruit]]\nname = "plum"\n');
    expect(() => writeToml({ a: null })).toThrow("TOML has no empty value, and there is one at a.");
});

test("any table written as TOML reads back the same", () => {
    const samples: { [key: string]: Value }[] = [
        {},
        { a: 1, b: -2.5, c: true, d: "text", e: "" },
        { "key with spaces": "v", "": "empty key", "é": "accent", "a.b": "dotted in one key" },
        { text: 'line\nbreak\ttab "quote" \\ back \x07 bell \x7f del 日本' },
        { list: [], nested: [[1, 2], ["a"]], tables: [{ a: 1 }, { b: { c: 2 } }], inline: [{ x: 1 }, 2] },
        { deep: { er: { est: { value: 1, list: [{ z: 1 }] } } }, after: { x: 1 } },
        { big: 9007199254740991, small: 5e-324, huge: 1e300, inf: Infinity, ninf: -Infinity },
        { emptytable: {}, emptyinline: [{}] },
        { fruit: [{ name: "apple", physical: { color: "red" }, variety: [{ name: "fuji" }, { name: "gala" }] }, { name: "plum" }] },
    ];
    for (const sample of samples) expect({ sample, back: readToml(writeToml(sample)).value }).toEqual({ sample, back: sample });
    expect(Number.isNaN(readToml(writeToml({ n: NaN })).value.n)).toBe(true);
});
