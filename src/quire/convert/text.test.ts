// What the text side holds true: a file's kind found by its ending and else by a careful look at what it
// holds; what each kind can become; and a conversion giving the text with its type and ending, refusing
// a pair that does not go together.

import { expect, test } from "bun:test";
import { readHtml, writeHtml } from "../md/html";
import { read } from "../md/read";
import { write } from "../md/write";
import { DataError } from "./data";
import { convertText, targetsFor, textKindOf } from "./text";

const engine = { toHtml: (markdown: string) => writeHtml(read(markdown).blocks), fromHtml: (html: string) => write({ ...read(""), blocks: readHtml(html) }) };

test("a file's kind is found by its ending first", () => {
    expect(textKindOf("notes.markdown", "{}")).toBe("md");
    expect(textKindOf("page.HTM", "")).toBe("html");
    expect(textKindOf("data.tsv", "")).toBe("csv");
    expect(textKindOf("x.json", "")).toBe("json");
    expect(textKindOf("x.yml", "")).toBe("yaml");
    expect(textKindOf("Cargo.toml", "")).toBe("toml");
});

test("with no ending, the kind is found by what the text holds, and left unsaid when unclear", () => {
    expect(textKindOf("pasted", "<!DOCTYPE html><p>x</p>")).toBe("html");
    expect(textKindOf("pasted", "<p>Hello <b>there</b></p>")).toBe("html");
    expect(textKindOf("pasted", '{"a": [1, 2]}')).toBe("json");
    expect(textKindOf("pasted", '[package]\nname = "x"\nversion = "1"\n')).toBe("toml");
    expect(textKindOf("pasted", "name: Jo\ntags:\n  - a\n")).toBe("yaml");
    expect(textKindOf("pasted", "a,b,c\n1,2,3\n4,5,6\n")).toBe("csv");
    expect(textKindOf("pasted", "# Title\n\nSome *text* and [a link](https://x.y).\n")).toBe("md");
    expect(textKindOf("pasted", "just a sentence.")).toBeUndefined();
    expect(textKindOf("pasted", "")).toBeUndefined();
});

test("Markdown and HTML become each other, and the four data formats each other", () => {
    expect(targetsFor("md")).toEqual(["html"]);
    expect(targetsFor("html")).toEqual(["md"]);
    expect(targetsFor("csv")).toEqual(["json", "yaml", "toml"]);
    expect(targetsFor("toml")).toEqual(["csv", "json", "yaml"]);
});

test("a conversion gives the text with its type and ending, and refuses a pair that does not go together", () => {
    const json = convertText("a,b\n1,2\n", "csv", "json", { types: true });
    expect(json).toEqual({ text: '[\n  {\n    "a": 1,\n    "b": 2\n  }\n]\n', notes: [], type: "application/json", ending: ".json" });
    expect(convertText('[{"a": 1}]', "json", "csv", { separator: "\t" })).toEqual({ text: "a\r\n1\r\n", notes: [], type: "text/tab-separated-values", ending: ".tsv" });
    const html = convertText("# Hi\n", "md", "html", { title: "hi" }, engine);
    expect(html.type).toBe("text/html");
    expect(html.ending).toBe(".html");
    expect(html.text).toContain("<h1>Hi</h1>");
    expect(convertText("<h1>Hi</h1>", "html", "md", {}, engine).text).toBe("# Hi\n");
    expect(() => convertText("# Hi", "md", "json", {})).toThrow(DataError);
    expect(() => convertText("# Hi", "md", "json", {})).toThrow("Markdown cannot be made into JSON here.");
    expect(() => convertText("# Hi", "md", "html", {})).toThrow("Markdown and HTML cannot be converted on this page.");
});
