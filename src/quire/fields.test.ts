// Where Enter in a field of the writing puts the caret: into a folding section's first line from its
// summary, past a component from one of its properties, and never nowhere. The keys themselves are
// pressed in the browser in in-text.test.ts.

import { expect, test } from "bun:test";
import { afterField, freshFold } from "./fields";
import { read } from "./read";

test("Enter in a folding section's summary goes to the start of the section's first line", () => {
    const doc = read("Before\n\n<details>\n<summary>More</summary>\n\nHidden text.\n\n</details>\n\nAfter\n");
    expect(afterField(doc, [1], "summary")).toEqual({ path: [1, 0], offset: 0 });
});

test("a summary over a section with only a list in it goes into the list's first item", () => {
    const doc = read("<details>\n<summary>More</summary>\n\n- one\n- two\n\n</details>\n");
    expect(afterField(doc, [0], "summary")).toEqual({ path: [0, 0, 0, 0], offset: 0 });
});

test("Enter in a component's property goes to the first line after the component, or back to the last one before it", () => {
    const doc = read('Before\n\n<Figure src="a.png" />\n\nAfter\n', { mdx: true });
    expect(afterField(doc, [1], "prop")).toEqual({ path: [2], offset: 0 });
    const last = read('Before\n\n<Figure src="a.png" />\n', { mdx: true });
    expect(afterField(last, [1], "prop")).toEqual({ path: [0], offset: 0 });
});

test("a folding section just made round the caret, with no summary yet, is found so its summary can take the keyboard first", () => {
    const before = read("Line\n");
    const after = read("<details>\n<summary></summary>\n\nLine\n\n</details>\n");
    expect(freshFold(before, after, [0, 0])).toEqual([0]);
    // one that was there already, or that has a summary, is left alone
    expect(freshFold(after, after, [0, 0])).toBeUndefined();
    expect(freshFold(before, read("<details>\n<summary>Named</summary>\n\nLine\n\n</details>\n"), [0, 0])).toBeUndefined();
    expect(freshFold(before, read("Line\n\nMore\n"), [1])).toBeUndefined();
});

test("a nested section's summary goes into its own first line, not the outer section's", () => {
    const doc = read("<details>\n<summary>Outer</summary>\n\nFirst.\n\n<details>\n<summary>Inner</summary>\n\nDeep.\n\n</details>\n\n</details>\n");
    expect(afterField(doc, [0, 1], "summary")).toEqual({ path: [0, 1, 0], offset: 0 });
});
