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
    // the look of the Markdown kinds (code blocks, callouts, folding sections), which the shared page leaves out
    const css = await Bun.file(`${import.meta.dir}/../styles/quire-markdown.css`).text();
    await page?.tab.run(`(() => { const style = document.createElement("style"); style.textContent = ${JSON.stringify(css)}; document.head.append(style); })()`);
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

test("a blank line can be typed in a code block, and two empty lines at its end then Enter leave it", async () => {
    if (skip("a code block's blank lines")) return;
    const { tab } = page!;
    await page!.reset("```\nx\n```\n", [0], 1);
    await tab.press("Backspace");
    await tab.type("a");
    await tab.press("Enter");
    await tab.type("b");
    await tab.press("Enter");
    await tab.press("Enter");
    await tab.type("c");
    expect(await page!.md()).toBe("```\na\nb\n\nc\n```\n");
    await tab.press("Enter");
    await tab.press("Enter");
    await tab.press("Enter");
    await tab.type("after");
    expect(await page!.md()).toBe("```\na\nb\n\nc\n```\n\nafter\n");
});

test("the down arrow on a code block's last line at the document's end goes to a new line under it", async () => {
    if (skip("the down arrow out of a code block")) return;
    const { tab } = page!;
    await page!.reset("```\nlast\n```\n", [0], 2);
    await tab.press("ArrowDown");
    await tab.type("out");
    expect(await page!.md()).toBe("```\nlast\n```\n\nout\n");
});

test("a code block's language is always shown once set, and is chosen from a menu that typing narrows; Escape leaves it as it was", async () => {
    if (skip("a code block's language menu")) return;
    const { tab } = page!;
    await page!.reset("Before\n\n```ts\nlet a = 1\n```\n", [0], 3);
    // shown with the caret elsewhere and nothing pointed at
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-lang-corner')).opacity")).toBe("1");
    expect(await tab.run("document.querySelector('.quire-lang').textContent")).toBe("TypeScript");
    await page!.press(".quire-lang");
    await tab.wait(400);
    expect(await keyboard()).toBe("input.quire-link-field quire-language-field");
    expect(await tab.run("document.querySelector('.quire-language-list .pressed').textContent")).toBe("TypeScript");
    await tab.type("py");
    expect(await tab.run("[...document.querySelectorAll('.quire-language-list .quire-menu-label')].map((each) => each.textContent)")).toEqual(["Python"]);
    await tab.press("Enter");
    await tab.wait(300);
    expect(await page!.md()).toBe("Before\n\n```py\nlet a = 1\n```\n");
    // the caret went into the code
    expect(await keyboard()).toBe("writing");
    expect(await caret()).toEqual({ path: [1], offset: 0 });
    await page!.press(".quire-lang");
    await tab.wait(400);
    await tab.press("Escape");
    await tab.wait(300);
    expect(await page!.md()).toBe("Before\n\n```py\nlet a = 1\n```\n");
    expect(await keyboard()).toBe("writing");
});

test("a code block with no language says Plain text while the caret is in it, and hides it otherwise", async () => {
    if (skip("a plain code block's control")) return;
    const { tab } = page!;
    await page!.reset("Before\n\n```\nplain\n```\n", [0], 0);
    await tab.wait(250);
    // (the pointer may still rest over the block from the test before, which shows it too, so the caret's mark is what is read)
    expect(await tab.run("document.querySelector('pre.quire-code').classList.contains('quire-editing')")).toBe(false);
    await tab.run("q.select([1], 2)");
    await tab.wait(250);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-lang-corner')).opacity")).toBe("1");
    expect(await tab.run("document.querySelector('.quire-lang').textContent")).toBe("Plain text");
});

test("a callout's kind is chosen from a menu of the five, not stepped round by pressing it", async () => {
    if (skip("a callout's kind menu")) return;
    const { tab } = page!;
    await page!.reset("> [!NOTE]\n> Mind this.\n", [0, 0], 2);
    await page!.press(".quire-callout-kind");
    await tab.wait(400);
    expect(await tab.run("[...document.querySelectorAll('.quire-menu.open .quire-menu-label')].map((each) => each.textContent)")).toEqual(["Note", "Tip", "Important", "Warning", "Caution"]);
    expect(await page!.md()).toBe("> [!NOTE]\n> Mind this.\n");
    await page!.press(".quire-menu.open .quire-menu-line", "Warning");
    await tab.wait(300);
    expect(await page!.md()).toBe("> [!WARNING]\n> Mind this.\n");
    expect(await keyboard()).toBe("writing");
    expect(await caret()).toEqual({ path: [0, 0], offset: 2 });
    // a click no pointer made, as a screen reader sends, opens the menu with its first line ready for the arrows
    await tab.run("document.querySelector('[data-callout-kind]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))");
    await tab.wait(400);
    expect(await tab.run("document.activeElement.textContent")).toBe("Note");
    await tab.press("Escape");
    await tab.wait(300);
    expect(await page!.md()).toBe("> [!WARNING]\n> Mind this.\n");
});

test("a folding section's arrow folds it away in the editor and back, changing nothing saved; closed for readers is a choice of its own", async () => {
    if (skip("a folding section's arrow")) return;
    const { tab } = page!;
    const source = "<details>\n<summary>More</summary>\n\nHidden text.\n\n</details>\n\nAfter\n";
    await page!.reset(source, [1], 0);
    const bodyHeight = () => tab.run<number>("document.querySelector('.quire-fold-body').getBoundingClientRect().height");
    expect(await bodyHeight()).toBeGreaterThan(10);
    expect(await tab.run("document.querySelector('.quire-fold-readers').getAttribute('aria-pressed')")).toBe("true");
    await page!.press(".quire-fold-turn");
    // it closes over time, not in one step
    await tab.wait(60);
    const closing = await bodyHeight();
    await tab.wait(400);
    expect(closing).toBeGreaterThan(0);
    expect(await bodyHeight()).toBe(0);
    expect(await tab.run("document.querySelector('.quire-fold-turn').getAttribute('aria-expanded')")).toBe("false");
    expect(await page!.md()).toBe(source);
    // the choice for readers is saved and leaves it folded in the editor
    await page!.press(".quire-fold-readers");
    expect(await page!.md()).toBe("<details open>\n<summary>More</summary>\n\nHidden text.\n\n</details>\n\nAfter\n");
    expect(await tab.run("document.querySelector('.quire-fold').classList.contains('folded')")).toBe(true);
    await page!.press(".quire-fold-turn");
    await tab.wait(400);
    expect(await bodyHeight()).toBeGreaterThan(10);
    // a caret put inside a folded section unfolds it
    await page!.press(".quire-fold-turn");
    await tab.wait(400);
    await tab.run("q.select([0, 0], 3)");
    await tab.wait(400);
    expect(await bodyHeight()).toBeGreaterThan(10);
});

test("a folding section just inserted takes the keyboard into its summary, whose empty word is quiet", async () => {
    if (skip("a new folding section's summary")) return;
    const { tab } = page!;
    await page!.reset("Line\n", [0], 4);
    await page!.menuLine("Insert", "Folding section");
    await tab.wait(100);
    expect(await keyboard()).toBe("input.quire-summary");
    expect(await tab.run("document.querySelector('.quire-summary').placeholder")).toBe("Summary");
    await tab.type("Spoilers");
    await tab.press("Enter");
    await tab.type("x");
    expect(await page!.md()).toBe("<details>\n<summary>Spoilers</summary>\n\nxLine\n\n</details>\n");
});
