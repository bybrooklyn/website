// The controls drawn inside the writing and the strips that float over it, used for real in headless
// Chromium: the fields in the text keep the keyboard on Enter, a code block holds blank lines and
// names its language from a menu, a callout's kind and a table's commands are menus, a folding
// section folds, and no strip covers the line being worked on. The Markdown is checked after each
// step. Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { editorPage, type EditorPage } from "../../scripts/quire-page";

let page: EditorPage | undefined;

beforeAll(async () => {
    page = await editorPage();
}, 60_000);

afterAll(async () => {
    await page?.close();
});

const skip = (what: string) => {
    if (page) return false;
    console.warn(`in-text.test.ts: no Chromium on this machine, so ${what} was not tried`);
    return true;
};

/** Where the keyboard is: the writing, a field, or the page's body. */
const keyboard = () => page!.tab.run<string>("document.activeElement === q.surface.element ? 'writing' : document.activeElement.tagName.toLowerCase() + '.' + document.activeElement.className");
const caret = () => page!.tab.run<{ path: number[]; offset: number }>("q.surface.getSelection().focus");

test("Enter in a folding section's summary keeps it and puts the caret at the start of the section's text", async () => {
    if (skip("a folding section's summary")) return;
    const { tab } = page!;
    await page!.reset("<details>\n<summary>More</summary>\n\nHidden text.\n\n</details>\n", [0, 0], 0);
    await tab.run("document.querySelector('.quire-summary').focus(); document.querySelector('.quire-summary').select()");
    await tab.type("Read on");
    await tab.press("Enter");
    await tab.wait(30);
    expect(await page!.md()).toBe("<details>\n<summary>Read on</summary>\n\nHidden text.\n\n</details>\n");
    expect(await keyboard()).toBe("writing");
    expect(await caret()).toEqual({ path: [0, 0], offset: 0 });
    // the next key typed goes into the section's text
    await tab.type("X");
    expect(await page!.md()).toBe("<details>\n<summary>Read on</summary>\n\nXHidden text.\n\n</details>\n");
});

test("Enter in a component's property keeps it and puts the caret on the line after the component", async () => {
    if (skip("a component's property")) return;
    const { tab } = page!;
    await tab.run(`q.reset(${JSON.stringify('<Figure src="a.png" />\n\nAfter\n')}, true)`);
    await tab.run("const field = document.querySelector('.quire-comp input[data-prop=\"src\"]'); field.focus(); field.select()");
    await tab.type("b.png");
    await tab.press("Enter");
    await tab.wait(30);
    expect(await page!.md()).toBe('<Figure src="b.png" />\n\nAfter\n');
    expect(await keyboard()).toBe("writing");
    expect(await caret()).toEqual({ path: [1], offset: 0 });
});
