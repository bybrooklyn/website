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
    const closing = await tab.run<number>("document.querySelector('.quire-fold-body').getAnimations().length");
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

test("a right-click in a table opens its menu, with every command and those that cannot act here dimmed; the menu key opens it at the cell", async () => {
    if (skip("a table's menu")) return;
    const { tab } = page!;
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    await page!.reset(table, [0, 1, 1], 0);
    await tab.wait(100);
    const lines = () => tab.run<[string, boolean][]>("[...document.querySelectorAll('.quire-table-menu.open .quire-menu-line')].map((line) => [line.querySelector('.quire-menu-label').textContent, line.disabled])");
    await tab.run("(() => { const cell = document.querySelectorAll('.quire td')[1]; const box = cell.getBoundingClientRect(); cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 4, clientY: box.top + 4 })); })()");
    await tab.wait(400);
    expect(await lines()).toEqual([
        ["Add a row above", false],
        ["Add a row below", false],
        ["Add a column to the left", false],
        ["Add a column to the right", false],
        ["Remove this row", false],
        ["Remove this column", false],
        ["Remove the table", false],
        ["Sort the rows A to Z", false],
        ["Sort the rows Z to A", false],
        ["Align the column left", false],
        ["Centre the column", false],
        ["Align the column right", false],
    ]);
    await page!.press(".quire-table-menu.open .quire-menu-line", "Add a row above");
    await tab.wait(100);
    expect(await page!.md()).toBe("| a   | b   |\n| --- | --- |\n|     |     |\n| 1   | 2   |\n");
    expect(await keyboard()).toBe("writing");
    // in the heading row, the menu key: what cannot act there is dimmed, and the arrows pass over it
    await page!.reset(table, [0, 0, 0], 0);
    await tab.wait(100);
    await tab.run("q.surface.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }))");
    await tab.wait(400);
    const dimmed = (await lines()).filter(([, off]) => off).map(([label]) => label);
    expect(dimmed).toEqual(["Add a row above", "Remove this row"]);
    expect(await tab.run("document.activeElement.textContent")).toBe("Add a row below");
    await tab.press("ArrowDown");
    await tab.press("ArrowDown");
    await tab.press("ArrowDown");
    expect(await tab.run("document.activeElement.textContent")).toBe("Remove this column");
    await tab.press("Escape");
    await tab.wait(300);
    expect(await keyboard()).toBe("writing");
    // and the strip's own remove-row button is dimmed in the heading row rather than live and doing nothing
    expect(await tab.run("document.querySelector('.quire-table-tools button[aria-label=\"Remove this row\"]').disabled")).toBe(true);
    await tab.run("q.select([0, 1, 0], 0)");
    await tab.wait(100);
    expect(await tab.run("document.querySelector('.quire-table-tools button[aria-label=\"Remove this row\"]').disabled")).toBe(false);
    // Remove the table leaves an empty line in its place
    await tab.run("(() => { const cell = document.querySelector('.quire td'); const box = cell.getBoundingClientRect(); cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 4, clientY: box.top + 4 })); })()");
    await tab.wait(400);
    await page!.press(".quire-table-menu.open .quire-menu-line", "Remove the table");
    expect(await page!.md()).toBe("");
});

/** Whether a strip's box covers the line of text from `top` to `bottom`, or any of the lines just above and below it, `line` tall. */
const covers = (strip: { y: number; height: number }, top: number, bottom: number, line: number) => strip.y < bottom + line && strip.y + strip.height > top - line;

test("the bar over selected words covers neither them nor the line above or below them", async () => {
    if (skip("the selection bar's place")) return;
    const { tab } = page!;
    const words = Array.from({ length: 120 }, (_, k) => `word${k}`).join(" ");
    await page!.reset(`${words}\n`, [0], 0);
    // a word some lines down the paragraph, with text all round it
    const start = words.indexOf("word60");
    await tab.run(`q.select([0], ${start}, [0], ${start + 6})`);
    await tab.wait(400);
    const bar = await tab.run<{ y: number; height: number }>("q.box('.quire-select-bar.shown')");
    const chosen = await tab.run<{ top: number; bottom: number; line: number }>("(() => { const box = document.getSelection().getRangeAt(0).getBoundingClientRect(); return { top: box.top, bottom: box.bottom, line: parseFloat(getComputedStyle(q.surface.element).lineHeight) }; })()");
    expect(bar).not.toBeNull();
    expect(covers(bar, chosen.top, chosen.bottom, chosen.line - 1)).toBe(false);
});

test("the bar over selected words holds bold, italic, underline, strikethrough, link and comment, then the three block buttons", async () => {
    if (skip("the selection bar's buttons")) return;
    const { tab } = page!;
    await page!.reset("Some words here.\n", [0], 5, [0], 10);
    await tab.wait(400);
    expect(await tab.run("[...document.querySelectorAll('.quire-select-bar.shown button')].map((each) => each.getAttribute('aria-label'))")).toEqual(["Bold", "Italic", "Underline", "Strikethrough", "Link", "Comment", "Turn into a heading", "Turn into a quote", "Turn into a list"]);
    await page!.press(".quire-select-bar button", "Underline");
    expect(await page!.md()).toBe("Some <u>words</u> here.\n");
    await page!.press(".quire-select-bar button", "Comment");
    await tab.wait(300);
    expect(await tab.run("document.activeElement.classList.contains('quire-note-field')")).toBe(true);
    await tab.press("Escape");
    await tab.wait(200);
});

test("find stepping to a match brings no bar over it", async () => {
    if (skip("find without the selection bar")) return;
    const { tab } = page!;
    await page!.reset("One apple here.\n\nAnother apple there.\n", [0], 0);
    await tab.press("f", { ctrl: true });
    await tab.wait(300);
    await tab.type("apple");
    await tab.press("Enter");
    await tab.wait(300);
    expect(await tab.run("!!document.querySelector('.quire-select-bar.shown')")).toBe(false);
    // Escape leaves the match selected in the text, still with no bar over it
    await tab.press("Escape");
    await tab.wait(300);
    expect(await tab.run("(() => { const { anchor, focus } = q.surface.getSelection(); return Math.abs(focus.offset - anchor.offset); })()")).toBe(5);
    expect(await tab.run("!!document.querySelector('.quire-select-bar.shown')")).toBe(false);
});

test("a table's strip and a picture's strip cover neither their table or picture nor the line before it", async () => {
    if (skip("the table and picture strips' place")) return;
    const { tab } = page!;
    await page!.reset("Some words before the table.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter.\n", [1, 1, 0], 0);
    await tab.wait(400);
    const strip = await tab.run<{ y: number; height: number }>("q.box('.quire-table-tools.shown')");
    const table = await tab.run<{ y: number; height: number }>("q.box('.quire table')");
    const before = await tab.run<{ y: number; height: number }>("q.box('.quire > p')");
    expect(strip.y + strip.height).toBeLessThanOrEqual(before.y);
    expect(strip.y + strip.height).toBeLessThanOrEqual(table.y);
    const picture = await tab.run<string>("location.href.replace(/page\\.html$/, 'wide.svg')");
    await page!.reset(`Some words before the picture.\n\n![A picture](${picture})\n\nAfter.\n`, [0], 0);
    await tab.run("new Promise((done) => { const img = document.querySelector('.quire-image img'); img.complete ? done() : img.onload = done; })");
    await page!.press(".quire-image img");
    await tab.wait(400);
    const tools = await tab.run<{ y: number; height: number }>("q.box('.quire-picture-strip')");
    const line = await tab.run<{ y: number; height: number }>("q.box('.quire > p')");
    const shown = await tab.run<{ y: number; height: number }>("q.box('.quire-image img')");
    expect(tools.y + tools.height <= line.y || tools.y >= shown.y + shown.height).toBe(true);
    await tab.press("Escape");
});

test("a picked picture: no caret blinks beside it, no empty slot in its strip, and wrapping a centred one is dimmed with the reason", async () => {
    if (skip("a picked picture")) return;
    const { tab } = page!;
    const picture = await tab.run<string>("location.href.replace(/page\\.html$/, 'wide.svg')");
    await page!.reset(`Before.\n\n<div align="center">\n\n![A picture](${picture})\n\n</div>\n\nAfter.\n`, [0], 2);
    await tab.run("new Promise((done) => { const img = document.querySelector('.quire-image img'); img.complete ? done() : img.onload = done; })");
    await tab.wait(300);
    const caretShown = () => tab.run<string>("getComputedStyle(document.querySelector('.quire-caret')).opacity");
    await page!.press(".quire-image img");
    await tab.wait(400);
    expect(await caretShown()).toBe("0");
    // at its original size the button for it closes up to nothing
    expect(await tab.run("document.querySelector('.quire-own-size').getBoundingClientRect().width")).toBe(0);
    await tab.run("(() => { const box = document.querySelector('.quire-image img').getBoundingClientRect(); document.querySelector('.quire-image img').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left + 30, clientY: box.top + 30 })); })()");
    await tab.wait(400);
    expect(await tab.run("[...document.querySelectorAll('.quire-picture-menu .quire-menu-line')].map((line) => [line.querySelector('.quire-menu-label').textContent, line.disabled, line.querySelector('.quire-menu-hint')?.textContent ?? ''])")).toEqual([
        ["Picture options", false, ""],
        ["Wrap text", true, "Left or right only"],
        ["Replace", false, ""],
        ["Remove", false, ""],
    ]);
    await page!.press(".quire-picture-menu .quire-menu-line", "Picture options");
    await tab.wait(500);
    expect(await tab.run("document.querySelector('.quire-picture-wrap').disabled")).toBe(true);
    expect(await tab.run("document.querySelector('.quire-picture-note').classList.contains('shown')")).toBe(true);
    await tab.press("Escape");
    await tab.wait(300);
    await tab.press("Escape");
    await tab.wait(300);
});

test("an empty definition list says which line is the term and which the definition; maths and a diagram are named, with no language to change", async () => {
    if (skip("the definition list's and drawn blocks' words")) return;
    const { tab } = page!;
    await page!.reset("", [0], 0);
    await page!.menuLine("Insert", "Definition list");
    await tab.wait(100);
    expect(await tab.run("[...document.querySelectorAll('.quire-terms [data-empty]')].map((each) => each.dataset.empty)")).toEqual(["Term", "Definition"]);
    await tab.type("Word");
    expect(await tab.run("[...document.querySelectorAll('.quire-terms [data-empty]')].map((each) => each.dataset.empty)")).toEqual(["Definition"]);
    await page!.reset("$$\nx^2\n$$\n\n```mermaid\nflowchart LR\n  A --> B\n```\n", [0], 0);
    expect(await tab.run("[...document.querySelectorAll('.quire-drawn .quire-lang')].map((each) => each.tagName + ' ' + each.textContent)")).toEqual(["SPAN Maths", "SPAN Diagram"]);
});

test("a table of contents has its own Update, which brings it up to the headings", async () => {
    if (skip("the table of contents' Update")) return;
    const { tab } = page!;
    await page!.reset("## One\n\nText.\n", [1], 0);
    await page!.menuLine("Insert", "Table of contents");
    await tab.wait(100);
    const before = await page!.md();
    expect(before).toContain("[One]");
    await tab.run(`q.reset(${JSON.stringify(before.replace("## One", "## One renamed"))})`);
    await page!.press(".quire-contents-update");
    await tab.wait(50);
    expect(await page!.md()).toContain("[One renamed]");
});

test("a right-click on words opens the text's own menu, whose lines do what the menus' do; Shift with it leaves the browser's", async () => {
    if (skip("the text's right-click menu")) return;
    const { tab } = page!;
    await page!.reset("Some words here.\n", [0], 5, [0], 10);
    await tab.wait(100);
    const rightClick = (shift: boolean) => tab.run<boolean>(`(() => { const p = document.querySelector('.quire > p'); const box = p.getBoundingClientRect(); const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: ${shift}, clientX: box.left + 60, clientY: box.top + 8 }); p.dispatchEvent(event); return event.defaultPrevented; })()`);
    expect(await rightClick(true)).toBe(false);
    expect(await rightClick(false)).toBe(true);
    await tab.wait(400);
    expect(await tab.run("[...document.querySelectorAll('.quire-text-menu.open .quire-menu-label')].map((each) => each.textContent)")).toEqual(["Cut", "Copy", "Link", "Comment", "Bold", "Italic", "Underline"]);
    await page!.press(".quire-text-menu.open .quire-menu-line", "Bold");
    await tab.wait(50);
    expect(await page!.md()).toBe("Some **words** here.\n");
    // the menu key opens it at the caret with its first line ready; with nothing selected, cut and copy are dimmed and passed over
    await tab.run("q.select([0], 2)");
    await tab.run("q.surface.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }))");
    await tab.wait(400);
    expect(await tab.run("document.activeElement.querySelector('.quire-menu-label').textContent")).toBe("Link");
    await tab.press("Escape");
    await tab.wait(300);
    expect(await keyboard()).toBe("writing");
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
