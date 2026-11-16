// What the YAML reader and writer hold true: the common subset read exactly (block and flow collections,
// the three kinds of scalar, `|` and `>` blocks with their chomping, comments, document markers, the 1.2
// core schema's types), everything past it refused with its line, and any value written and read back
// the same.

import { expect, test } from "bun:test";
import { DataError } from "./errors";
import { needsQuotes, readYaml, writeYaml } from "./yaml";
import type { Value } from "./data";

const refused = (text: string): DataError => {
    try {
        readYaml(text);
    } catch (error) {
        if (error instanceof DataError) return error;
        throw error;
    }
    throw new Error(`read without complaint: ${text}`);
};

test("block mappings and lists nest by indentation, lists under a key at its own indentation too", () => {
    expect(readYaml("name: Jo\nage: 41\ntags:\n  - a\n  - b\nmore:\n- x\n- y\nowner:\n  name: Sam\n  pets:\n    - kind: cat\n      name: Tib\n    - kind: dog\n")).toEqual({
        name: "Jo",
        age: 41,
        tags: ["a", "b"],
        more: ["x", "y"],
        owner: { name: "Sam", pets: [{ kind: "cat", name: "Tib" }, { kind: "dog" }] },
    });
    expect(readYaml("- - a\n  - b\n- - c\n")).toEqual([["a", "b"], ["c"]]);
    expect(readYaml("-\n  a: 1\n- \n")).toEqual([{ a: 1 }, null]);
});

test("values are typed by the 1.2 core schema, so yes, no, on and off stay words", () => {
    expect(readYaml("a: ~\nb: null\nc:\nd: true\ne: False\nf: yes\ng: off\nh: 012\ni: 0x1F\nj: 0o17\nk: -1.5e3\nl: .inf\nm: -.Inf\nn: .nan\no: 1.2.3\n")).toEqual({
        a: null,
        b: null,
        c: null,
        d: true,
        e: false,
        f: "yes",
        g: "off",
        h: 12,
        i: 31,
        j: 15,
        k: -1500,
        l: Infinity,
        m: -Infinity,
        n: NaN,
        o: "1.2.3",
    });
});

test("quoted values keep their escapes and fold their line breaks; plain values fold too", () => {
    expect(readYaml(`a: "tab\\there \\u00e9 \\x41 \\"q\\""\nb: 'it''s # not a comment'\nc: plain words # a comment\nd: "one\n  two\n\n  three"\ne: first\n  second\n`)).toEqual({
        a: 'tab\there é A "q"',
        b: "it's # not a comment",
        c: "plain words",
        d: "one two\nthree",
        e: "first second",
    });
    expect(readYaml("url: http://example.com/a#b\n")).toEqual({ url: "http://example.com/a#b" });
});

test("flow lists and mappings are read, across lines, with comments", () => {
    expect(readYaml("a: [1, two, \"three\", [4], {five: 5}]\nb: {x: 1, y: [a, b], z}\nc: [\n  1, # one\n  2,\n]\nd: []\ne: {}\n")).toEqual({
        a: [1, "two", "three", [4], { five: 5 }],
        b: { x: 1, y: ["a", "b"], z: null },
        c: [1, 2],
        d: [],
        e: {},
    });
});

test("| keeps line breaks and > folds them, with -, + and an indentation number", () => {
    expect(readYaml("a: |\n  one\n    two\n  three\nb: >\n  one\n  two\n\n  three\n    deeper\n  four\nc: |-\n  no end\nd: |+\n  kept\n\n\ne: |2\n    starts with spaces\nf: last\n")).toEqual({
        a: "one\n  two\nthree\n",
        b: "one two\nthree\n  deeper\nfour\n",
        c: "no end",
        d: "kept\n\n\n",
        e: "  starts with spaces\n",
        f: "last",
    });
    expect(readYaml("a: |\nb: 1\n")).toEqual({ a: "", b: 1 });
});

test("document markers, a byte order mark, CR LF and comments are read", () => {
    expect(readYaml("\ufeff# top\r\n---\r\na: 1 # one\r\n\r\n# between\r\nb: 2\r\n...\r\n")).toEqual({ a: 1, b: 2 });
    expect(readYaml("")).toBeNull();
    expect(readYaml("just words\n")).toBe("just words");
    expect(readYaml("--- [1, 2]\n")).toEqual([1, 2]);
});

test("anchors, aliases, tags, directives, more documents, complex keys, merge keys and a key given twice are refused with their lines", () => {
    expect(refused("a: 1\nb: &x 2\n").message).toBe("Line 2 uses an anchor or an alias (& or *), which this converter does not read. Write the value out in full.");
    expect(refused("a: *x\n").line).toBe(1);
    expect(refused("a: !!str 1\n").message).toBe("Line 1 uses a tag (!), which this converter does not read.");
    expect(refused("%YAML 1.2\n---\na: 1\n").message).toBe("Line 1 is a directive (%), which this converter does not read.");
    expect(refused("a: 1\n---\nb: 2\n").message).toBe("Line 2 starts another document. This converter reads one document a file.");
    expect(refused("a: 1\n...\nb: 2\n").line).toBe(3);
    expect(refused("? a\n: 1\n").message).toBe("Line 1 uses a complex key (?), which this converter does not read.");
    expect(refused("a: 1\n<<: {b: 2}\n").message).toBe("Line 2 uses a merge key (<<), which this converter does not read. Write the keys out in full.");
    expect(refused("a: 1\nb: 2\na: 3\n").message).toBe('The key "a" is given twice, on lines 1 and 3.');
    expect(refused("a: {x: 1, x: 2}\n").line).toBe(1);
});

test("broken layout is refused plainly, never guessed", () => {
    expect(refused("a:\n\tb: 1\n").message).toBe("Line 2 is indented with a tab. YAML allows only spaces there.");
    expect(refused("a: 1\n  b: 2\n").message).toBe("Line 2 is indented under a value that is already given.");
    expect(refused("a: b: c\n").message).toBe('Line 1 has a value with ": " in it. Put the value in quotes.');
    expect(refused('a: "open\nb: 1\n').message).toBe("A quote opened on line 1 is never closed.");
    expect(refused("a: [1, 2\n").message).toBe("A [ opened on line 1 is never closed.");
    expect(refused("a: 1\n- b\n").message).toBe("Line 2 starts a list item among keys. Put the list under a key.");
    expect(refused("a: 1\nwords\n").message).toBe("Line 2 should be a key and its value, written as key: value.");
    expect(refused('a: "\\q"\n').message).toBe("Line 1 has an escape \\q that YAML does not have.");
});

test("strings that would read back as something else are quoted, and nothing else is", () => {
    for (const text of ["", "true", "null", "~", "12", "1.5", ".inf", "a: b", "a #b", " lead", "trail ", "- x", "[x]", "#x", "&x", "*x", "!x", "---", "...", "tab\there", "x:"]) expect(needsQuotes(text)).toBe(true);
    expect(needsQuotes("yes it is")).toBe(false);
    expect(needsQuotes("http://example.com")).toBe(false);
    expect(needsQuotes("a#b")).toBe(false);
    expect(writeYaml({ a: "true", b: "plain", c: "" })).toBe('a: "true"\nb: plain\nc: ""\n');
});

test("lists of tables are written with the first key after the dash, strings of lines as | blocks", () => {
    expect(writeYaml({ people: [{ name: "Jo", age: 41 }, { name: "Sam" }], note: "one\ntwo\n", empty: [], none: {} })).toBe("people:\n  - name: Jo\n    age: 41\n  - name: Sam\nnote: |\n  one\n  two\nempty: []\nnone: {}\n");
});

test("any value written as YAML reads back the same", () => {
    const samples: Value[] = [
        null,
        true,
        0,
        -12.5,
        1e21,
        "",
        "plain",
        "with: colon",
        "line one\nline two",
        "ends with breaks\n\n\n",
        "\nstarts with a break",
        "  indented first line\nsecond",
        "no end",
        [],
        {},
        [1, "two", null, false, [3, [4]], { a: 1 }],
        { "key with spaces": 1, "": "empty key", "#hash": 2, "a: b": 3, "-dash": 4, "3": "number key", true: "true key", __proto__: "proto" },
        { nested: { deeper: { deepest: ["x", { y: "z" }] } }, list: [[], {}, [[]]], text: "a\tb", quote: "it's \"quoted\"", unicode: "é 日本 \u2028 sep", control: "bell\x07" },
        [{ a: [1, 2], b: { c: "line\nbreak" } }, [{ d: null }]],
        { weird: ["- not a list", "? not a key", "{not flow}", "'single'", '"double"', "%percent", "@at", "`tick`", "|pipe", ">fold", " ", "0x1F", "0o17", ".nan", "1e5", "NULL", "False"] },
    ];
    for (const sample of samples) {
        const written = writeYaml(sample);
        expect({ sample, back: readYaml(written) }).toEqual({ sample, back: sample });
    }
    expect(Number.isNaN(readYaml(writeYaml(NaN)))).toBe(true);
    expect(readYaml(writeYaml([Infinity, -Infinity]))).toEqual([Infinity, -Infinity]);
});
