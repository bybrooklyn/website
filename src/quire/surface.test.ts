// The editing surface, typed in for real: a page holding the surface is bundled and opened in
// headless Chromium, and keys are pressed one at a time as a person would press them. After each
// step the Markdown the document writes and the place of the cursor are checked, both in the model
// and in the page's own selection. Skipped, with a notice, on a machine with no Chromium.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium, type Browser } from "../../scripts/browser";

const here = import.meta.dir;

const SAMPLE = [
    "---",
    "title: Every block",
    "---",
    "",
    "# A heading",
    "",
    "A paragraph with *emphasis*, __strong__, `code`, a [link](https://example.com), a picture ![dot](data:image/gif;base64,R0lGODlhAQABAAAAACw=) and a break  ",
    "after it.",
    "",
    "* one",
    "* two",
    "  * nested",
    "",
    "1) first",
    "2) second",
    "",
    "- [ ] open",
    "- [x] done",
    "",
    "> quoted",
    "",
    "```js",
    "let a = 1;",
    "```",
    "",
    "| a | b |",
    "|:--|--:|",
    "| 1 | 2 |",
    "",
    "![A picture](data:image/gif;base64,R0lGODlhAQABAAAAACw=)",
    "",
    "***",
    "",
    "<Component prop={1} />",
    "",
    "A footnote.[^1]",
    "",
    "[^1]: The note.",
].join("\r\n");

// What the page does: one surface, with ways for the test to reach it.
const page = `
import { createSurface } from "${here}/surface.ts";
import { read } from "${here}/read.ts";
import { write } from "${here}/write.ts";
const element = document.querySelector("#editor");
const surface = createSurface(element, read(""));
window.quire = {
    surface,
    reset(markdown, mdx) { surface.setDocument(read(markdown, { mdx })); surface.focus(); },
    markdown: () => write(surface.getDocument()),
    selection: () => surface.getSelection().focus,
    // the page's own caret, read back as the text before it in its block
    before() {
        const selection = document.getSelection();
        const range = document.createRange();
        const block = selection.focusNode.nodeType === 1 ? selection.focusNode.closest("[data-holder]") : selection.focusNode.parentElement.closest("[data-holder]");
        range.setStart(block, 0);
        range.setEnd(selection.focusNode, selection.focusOffset);
        return range.toString();
    },
    paste(html, text) {
        const data = new DataTransfer();
        if (html) data.setData("text/html", html);
        if (text) data.setData("text/plain", text);
        element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
};
`;

async function open(): Promise<{ tab: Browser; folder: string }> {
    const folder = await mkdtemp(join(tmpdir(), "quire-surface-"));
    const tab = await browser({ width: 900, height: 900 });
    await Bun.write(`${folder}/page.ts`, page);
    const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const styles = "body{font:18px/1.6 serif;margin:2rem} #editor{outline:1px solid #ccc;padding:1rem;min-height:4rem} pre{background:#eee}";
    await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><style>${styles}</style><div id="editor"></div><script type="module">${await built.outputs[0]!.text()}</script>`);
    await tab.open(`file://${folder}/page.html`, 300);
    return { tab, folder };
}

test.skipIf(!chromium())(
    "typing in the surface: sentences, Enter, Backspace, bold, a heading, a list with Tab, undo, redo and paste",
    async () => {
        const { tab, folder } = await open();
        const markdown = () => tab.run<string>("quire.markdown()");
        const cursor = () => tab.run<{ path: number[]; offset: number }>("quire.selection()");
        const before = () => tab.run<string>("quire.before()");
        const repeat = async (key: string, times: number, held = {}) => {
            for (let index = 0; index < times; index++) await tab.press(key, held);
        };
        try {
            expect(tab.errors).toEqual([]);

            // a document drawn and focused, untouched, writes back the very bytes it was read from
            await tab.run(`quire.reset(${JSON.stringify(SAMPLE)}, true)`);
            await tab.wait(50);
            expect(await markdown()).toBe(SAMPLE);
            await tab.press("ArrowDown");
            await tab.press("ArrowRight");
            await tab.wait(50);
            expect(await markdown()).toBe(SAMPLE);

            // a sentence
            await tab.run(`quire.reset("")`);
            await tab.type("Hello there.");
            expect(await markdown()).toBe("Hello there.\n");
            expect(await cursor()).toEqual({ path: [0], offset: 12 });
            expect(await before()).toBe("Hello there.");

            // Enter in the middle, then Backspace at the start of the new block
            await repeat("ArrowLeft", 7);
            await tab.wait(30);
            await tab.press("Enter");
            expect(await markdown()).toBe("Hello\n\nthere.\n");
            expect(await cursor()).toEqual({ path: [1], offset: 0 });
            expect(await before()).toBe("");
            await tab.press("Backspace");
            expect(await markdown()).toBe("Hello there.\n");
            expect(await cursor()).toEqual({ path: [0], offset: 5 });
            expect(await before()).toBe("Hello");

            // bold over a selection made with Shift and the arrows
            await tab.press("End");
            await tab.type(" word");
            await repeat("ArrowLeft", 4, { shift: true });
            await tab.wait(30);
            await tab.press("b", { ctrl: true });
            expect(await markdown()).toBe("Hello there. **word**\n");
            await tab.press("End");
            await tab.wait(30);

            // a heading typed as Markdown
            await tab.press("Enter");
            await tab.type("## Title");
            expect(await markdown()).toBe("Hello there. **word**\n\n## Title\n");
            expect(await cursor()).toEqual({ path: [1], offset: 5 });
            expect(await before()).toBe("Title");

            // a list, the second item indented with Tab
            await tab.press("Enter");
            await tab.type("- one");
            await tab.press("Enter");
            await tab.type("two");
            await tab.press("Tab");
            expect(await markdown()).toBe("Hello there. **word**\n\n## Title\n\n- one\n  - two\n");
            expect(await cursor()).toEqual({ path: [2, 0, 1, 0, 0], offset: 3 });
            expect(await before()).toBe("two");

            // undo all the way back to the empty start, and redo all the way forward again
            const end = await markdown();
            for (let index = 0; index < 40; index++) await tab.press("z", { ctrl: true });
            expect((await markdown()).trim()).toBe("");
            for (let index = 0; index < 40; index++) await tab.press("z", { ctrl: true, shift: true });
            expect(await markdown()).toBe(end);
            expect(await cursor()).toEqual({ path: [2, 0, 1, 0, 0], offset: 3 });

            // HTML pasted with a list and a link becomes Markdown, the cursor after it
            await tab.run(`quire.reset("Before\\n")`);
            await tab.press("End");
            await tab.wait(30);
            await tab.run(`quire.paste('<p>said:</p><ul><li>alpha</li><li><a href="https://example.com" onclick="x()">beta</a></li></ul><script>window.bad = 1</script>', "said: alpha beta")`);
            await tab.wait(50);
            expect(await markdown()).toBe("Beforesaid:\n\n- alpha\n- [beta](https://example.com)\n");
            expect(await cursor()).toEqual({ path: [1, 1, 0], offset: 4 });
            expect(await before()).toBe("beta");
            expect(await tab.run("window.bad")).toBeUndefined();

            // text composed through an input method is shown while composing and typed into the model when committed
            await tab.run(`quire.reset("Ab **x\\n")`);
            await tab.press("End");
            await tab.wait(30);
            await tab.compose(["k", "ka", "か"], "か");
            await tab.wait(30);
            expect(await markdown()).toBe("Ab \\*\\*xか\n");
            expect(await cursor()).toEqual({ path: [0], offset: 7 });
            expect(await before()).toBe("Ab **xか");
            // the closing mark, composed and committed, makes bold; one undo gives the characters back
            await tab.compose(["*", "**"], "**");
            await tab.wait(30);
            expect(await markdown()).toBe("Ab **xか**\n");
            expect(await cursor()).toEqual({ path: [0], offset: 5 });
            await tab.press("z", { ctrl: true });
            expect(await markdown()).toBe("Ab \\*\\*xか\\*\\*\n");

            // plain text that looks like Markdown is read as Markdown
            await tab.run(`quire.reset("")`);
            await tab.run(`quire.paste("", "# Pasted\\n\\nWith **bold**.")`);
            await tab.wait(50);
            expect(await markdown()).toBe("# Pasted\n\nWith **bold**.\n");

            expect(tab.errors).toEqual([]);
        } finally {
            await tab.close();
            await rm(folder, { recursive: true, force: true });
        }
    },
    60_000,
);

test.skipIf(!chromium())(
    "a key typed in a block draws it again in the element it had, so its neighbours are not restyled, and undo and redo still show the right text",
    async () => {
        const { tab, folder } = await open();
        try {
            await tab.run(`quire.reset("One\\n\\nTwo\\n\\nThree\\n")`);
            await tab.run(`quire.surface.setSelection({ anchor: { path: [1], offset: 3 }, focus: { path: [1], offset: 3 } })`);
            await tab.run(`window.before = [...document.querySelector("#editor").children]`);
            await tab.type("s");
            expect(await tab.run<boolean[]>(`[...document.querySelector("#editor").children].map((each, index) => each === window.before[index])`)).toEqual([true, true, true]);
            expect(await tab.run<string>(`document.querySelector("#editor").textContent`)).toBe("OneTwosThree");
            await tab.press("Enter");
            await tab.type("# Big");
            expect(await tab.run<string>("quire.markdown()")).toBe("One\n\nTwos\n\n# Big\n\nThree\n");
            for (let index = 0; index < 10; index++) await tab.press("z", { ctrl: true });
            expect(await tab.run<string>("quire.markdown()")).toBe("One\n\nTwo\n\nThree\n");
            expect(await tab.run<string>(`document.querySelector("#editor").textContent`)).toBe("OneTwoThree");
            for (let index = 0; index < 10; index++) await tab.press("z", { ctrl: true, shift: true });
            expect(await tab.run<string>(`[...document.querySelector("#editor").children].map((each) => each.tagName + ":" + each.textContent).join(" ")`)).toBe("P:One P:Twos H1:Big P:Three");
            expect(tab.errors).toEqual([]);
        } finally {
            await tab.close();
            await rm(folder, { recursive: true, force: true });
        }
    },
    60_000,
);

if (!chromium()) console.warn("surface.test.ts: no Chromium on this machine, so the surface was not typed in.");
