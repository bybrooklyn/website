// What the slash menu is held to: typing after the slash narrows it to the right things, it knows
// when the slash is gone, and choosing takes the slash away and makes the block. Run with
// `bun test src/quire`.

import { expect, test } from "bun:test";
import { caret } from "./keys";
import { read } from "./read";
import { chooseSlash, filterSlash, SLASH_ITEMS, slashQuery } from "./slash";
import { write } from "./write";

const keys = (query: string) => filterSlash(query).map((item) => item.key);

test("with nothing typed after the slash every item is offered", () => {
    expect(keys("")).toEqual(SLASH_ITEMS.map((item) => item.key));
    expect(keys("   ")).toHaveLength(SLASH_ITEMS.length);
});

test("typing narrows the menu by name first, then by other words", () => {
    expect(keys("head")).toEqual(["heading1", "heading2", "heading3"]);
    expect(keys("h2")).toEqual(["heading2"]);
    expect(keys("list")).toEqual(["bullet", "number"]);
    expect(keys("TAB")).toEqual(["table"]);
    expect(keys("todo")).toEqual(["task"]);
    expect(keys("pic")).toEqual(["image"]);
    expect(keys("img")).toEqual(["image"]);
    expect(keys("zzz")).toEqual([]);
});

test("it knows what was typed after the slash, and when the slash is gone", () => {
    const doc = read("/hea\n\nplain\n");
    expect(slashQuery(doc, [0], 4)).toBe("hea");
    expect(slashQuery(doc, [0], 1)).toBe("");
    expect(slashQuery(doc, [1], 2)).toBeUndefined();
    expect(slashQuery(read("# /x\n"), [0], 2)).toBeUndefined();
});

test("choosing takes away the slash and what followed it and makes the block", () => {
    const item = (key: string) => SLASH_ITEMS.find((each) => each.key === key)!;
    const heading = chooseSlash({ doc: read("Above\n\n/head\n"), selection: caret([1], 5) }, item("heading2"));
    expect(write(heading.doc)).toBe("Above\n\n##\n");
    expect(heading.doc.blocks[1]).toMatchObject({ kind: "heading", level: 2, runs: [] });
    expect(heading.selection).toEqual(caret([1], 0));
    const tabled = chooseSlash({ doc: read("Above\n\n/tab\n"), selection: caret([1], 4) }, item("table"));
    expect(write(tabled.doc)).toBe("Above\n\n|     |     |     |\n| --- | --- | --- |\n|     |     |     |\n|     |     |     |\n");
    expect(tabled.selection).toEqual(caret([1, 0, 0], 0));
    const listed = chooseSlash({ doc: read("/\n"), selection: caret([0], 1) }, item("task"));
    expect(listed.doc.blocks[0]).toMatchObject({ kind: "list", style: "task" });
    const picture = chooseSlash({ doc: read("/pic\n"), selection: caret([0], 4) }, item("image"));
    expect(picture.doc.blocks[0]).toMatchObject({ kind: "paragraph", runs: [] });
});
