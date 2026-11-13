// What arrives at the surface besides plain keys: input methods, phone keyboards, spelling fixes,
// the browser's own menus and other keyboard layouts. Chrome's own input method is driven through
// the browser's debugging connection (a real composition); the orders that Android, iOS Safari and
// Firefox send are imitated by dispatching the same events in their order and changing the page as
// each browser would between them. These are imitations, written from what those browsers are known
// to send, not recordings. Skipped, with a notice, on a machine with no Chromium.

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium, type Browser } from "../../scripts/browser";
import { altGraph, shortcutKey } from "./surface";

const here = import.meta.dir;

// The page: one surface, and an imitation of an input method that changes the page as a browser does.
const page = `
import { createSurface } from "${here}/surface.ts";
import { read } from "${here}/read.ts";
import { write } from "${here}/write.ts";
const element = document.querySelector("#editor");
const surface = createSurface(element, read(""), { onImage: async (file) => file.name });
let composed;
const fire = (target, event) => (target.dispatchEvent(event), event.defaultPrevented);
// Chrome's InputEvent knows only the input types Chrome sends; the others (Safari's insertFromComposition, deleteContent) are given to the event by hand
const typed = (name, init) => {
    const event = new InputEvent(name, init);
    if (event.inputType !== init.inputType) Object.defineProperty(event, "inputType", { value: init.inputType });
    return event;
};
window.quire = {
    surface,
    element,
    reset(markdown, mdx) { surface.setDocument(read(markdown, { mdx })); surface.focus(); },
    markdown: () => write(surface.getDocument()),
    shown: () => [...element.children].map((each) => each.textContent).join("\\n"),
    select(path, from, to = from, end = path) { surface.setSelection({ anchor: { path, offset: from }, focus: { path: end, offset: to } }); },
    selection: () => surface.getSelection(),
    /** The events of a composition step by step. Each change to the page is the browser's: the composed text replaces the last. */
    start(target = document.activeElement) {
        fire(target, new KeyboardEvent("keydown", { key: "Unidentified", keyCode: 229, bubbles: true, cancelable: true }));
        const page = document.getSelection();
        composed = { target, range: page.getRangeAt(0).cloneRange() };
        fire(target, new CompositionEvent("compositionstart", { data: "", bubbles: true }));
    },
    /** Puts text where the composition is, as the browser does; with \`range\`, over that stretch of the page instead (Android composing an existing word). */
    write(text) {
        const range = composed.range;
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStart(node, 0);
        range.setEnd(node, text.length);
        document.getSelection().setBaseAndExtent(node, text.length, node, text.length);
        if (!node.parentNode.isConnected) composed.lost = true;
    },
    update(text, inputType = "insertCompositionText", cancelable = false) {
        const target = composed.target;
        fire(target, new CompositionEvent("compositionupdate", { data: text, bubbles: true }));
        const stopped = fire(target, typed("beforeinput", { inputType, data: text, isComposing: true, bubbles: true, cancelable }));
        if (!stopped) quire.write(text);
        fire(target, typed("input", { inputType, data: text, isComposing: true, bubbles: true }));
    },
    end(text) {
        fire(composed.target, new CompositionEvent("compositionend", { data: text, bubbles: true }));
    },
    /** Something the browser sends after the composition ended, in WebKit's order: its last input, which the page may not cancel. */
    after(inputType, text, cancelable) {
        const target = composed.target;
        const stopped = fire(target, typed("beforeinput", { inputType, data: text, bubbles: true, cancelable }));
        if (!stopped && composed.range.startContainer.isConnected) quire.write(text);
        fire(target, typed("input", { inputType, data: text, bubbles: true }));
    },
    /** A plain input event of the given type, with a target range over the given model stretch if any; the page is changed only if it was not cancelled and \`change\` says how. */
    input(inputType, data, range, cancelable = true, change) {
        let ranges = [];
        if (range) {
            const r = surface.rangeOf(range[0], range[1]);
            ranges = [new StaticRange({ startContainer: r.startContainer, startOffset: r.startOffset, endContainer: r.endContainer, endOffset: r.endOffset })];
        }
        const event = typed("beforeinput", { inputType, data, bubbles: true, cancelable, targetRanges: ranges });
        const stopped = fire(element, event);
        if (!stopped && change) change();
        if (!stopped) fire(element, typed("input", { inputType, data, bubbles: true }));
        return stopped;
    },
    key(init) {
        return fire(document.activeElement, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    },
};
`;

async function open(): Promise<{ tab: Browser; folder: string }> {
    const folder = await mkdtemp(join(tmpdir(), "quire-input-"));
    const tab = await browser({ width: 900, height: 900 });
    await Bun.write(`${folder}/page.ts`, page);
    const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const styles = "body{font:18px/1.6 serif;margin:2rem} #editor{outline:1px solid #ccc;padding:1rem;min-height:4rem} pre{background:#eee}";
    await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><style>${styles}</style><div id="editor"></div><script type="module">${await built.outputs[0]!.text()}</script>`);
    await tab.open(`file://${folder}/page.html`, 300);
    return { tab, folder };
}

/** A test with a page of its own. */
const inPage = (name: string, body: (tab: Browser) => Promise<void>) =>
    test.skipIf(!chromium())(
        name,
        async () => {
            const { tab, folder } = await open();
            try {
                await body(tab);
                expect(tab.errors).toEqual([]);
            } finally {
                await tab.close();
                await rm(folder, { recursive: true, force: true });
            }
        },
        60_000,
    );

const md = (tab: Browser) => tab.run<string>("quire.markdown()");
const shown = (tab: Browser) => tab.run<string>("quire.shown()");

describe("composition in a field inside the document stays in the field", () => {
    const fields: [string, string, string, string][] = [
        ["a card's property", "<Callout kind={1} title=\"Hi\" />\n\nText\n", "[data-prop=title]", "<Callout kind={1} title=\"Hi\" />\n\nText\n"],
        ["a code block's language", "```js\nlet a;\n```\n\nText\n", "[data-lang]", "```js\nlet a;\n```\n\nText\n"],
        ["a folding section's summary", "<details>\n<summary>Fold</summary>\n\nInside\n\n</details>\n\nText\n", "[data-summary]", "<details>\n<summary>Fold</summary>\n\nInside\n\n</details>\n\nText\n"],
    ];
    for (const [what, markdown, selector, same] of fields) {
        inPage(`in ${what}, a composition neither types into the text nor deletes its selection, and the field stays`, async (tab) => {
            await tab.run(`quire.reset(${JSON.stringify(markdown)}, true)`);
            // a selection in the text, which a composition in the field must leave alone
            const last = await tab.run<number>("quire.surface.getDocument().blocks.length - 1");
            await tab.run(`quire.select([${last}], 0, 4)`);
            const field = await tab.run<boolean>(`(() => { const f = document.querySelector(${JSON.stringify(selector)}); if (!f) return false; window.field = f; f.focus(); f.select?.(); return document.activeElement === f; })()`);
            expect(field).toBe(true);
            // Chrome's own input method, for real
            await tab.compose(["k", "か"], "か");
            await tab.wait(50);
            expect(await md(tab)).toBe(same);
            expect(await tab.run<boolean>("document.activeElement === window.field && window.field.isConnected")).toBe(true);
            expect(await tab.run<string>("window.field.value")).toContain("か");
            // and the events alone, as another browser sends them
            await tab.run("quire.start(window.field); quire.update('x'); quire.end('x')");
            await tab.wait(50);
            expect(await md(tab)).toBe(same);
            expect(await tab.run<boolean>("document.activeElement === window.field && window.field.isConnected")).toBe(true);
        });
    }
});

describe("composition in the text keeps the model and the page in step", () => {
    inPage("Chrome on a desktop, for real: a word composed, given up with Escape, composed over a selection, and undone as one step", async (tab) => {
        await tab.run(`quire.reset("Ab cd\\n")`);
        await tab.run("quire.select([0], 2)");
        await tab.compose(["n", "に", "にh", "にほ"], "日本");
        await tab.wait(30);
        expect(await md(tab)).toBe("Ab日本 cd\n");
        expect(await shown(tab)).toBe("Ab日本 cd");
        expect((await tab.run<{ focus: { offset: number } }>("quire.selection()")).focus.offset).toBe(4);
        // one composed word is one step of undo
        await tab.press("z", { ctrl: true });
        expect(await md(tab)).toBe("Ab cd\n");
        await tab.press("z", { ctrl: true, shift: true });
        expect(await md(tab)).toBe("Ab日本 cd\n");
        // over a selection inside the block: the composed text replaces it
        await tab.run("quire.select([0], 5, 7)");
        await tab.compose(["え", "えf"], "エフ");
        await tab.wait(30);
        expect(await md(tab)).toBe("Ab日本 エフ\n");
        expect(await shown(tab)).toBe("Ab日本 エフ");
    });

    inPage("Chrome's order, imitated: given up with Escape, nothing is typed and the cursor stays", async (tab) => {
        await tab.run(`quire.reset("Ab cd\\n")`);
        await tab.run("quire.select([0], 2)");
        await tab.run("quire.start(); quire.update('k'); quire.update('か'); quire.update(''); quire.end('')");
        await tab.wait(30);
        expect(await md(tab)).toBe("Ab cd\n");
        expect(await shown(tab)).toBe("Ab cd");
        expect((await tab.run<{ focus: { offset: number } }>("quire.selection()")).focus.offset).toBe(2);
    });

    inPage("Korean, imitated in Chrome's order: each update replaces the last syllable, and each syllable ends its own composition", async (tab) => {
        await tab.run(`quire.reset("")`);
        await tab.run("quire.select([0], 0)");
        await tab.run("quire.start(); quire.update('ㅎ'); quire.update('하'); quire.update('한'); quire.end('한')");
        await tab.run("quire.start(); quire.update('ㄱ'); quire.update('그'); quire.update('글'); quire.end('글')");
        await tab.wait(30);
        expect(await md(tab)).toBe("한글\n");
        expect(await shown(tab)).toBe("한글");
        expect((await tab.run<{ focus: { offset: number } }>("quire.selection()")).focus.offset).toBe(2);
    });

    inPage("Firefox's order, imitated: the last input arrives after compositionend, and nothing is doubled", async (tab) => {
        await tab.run(`quire.reset("Ab\\n")`);
        await tab.run("quire.select([0], 2)");
        await tab.run("quire.start(); quire.update('c'); quire.update('cd'); quire.end('cd'); quire.element.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: 'cd', bubbles: true }))");
        await tab.wait(30);
        expect(await md(tab)).toBe("Abcd\n");
        expect(await shown(tab)).toBe("Abcd");
    });

    inPage("iOS Safari's order, imitated: the composition's last insert comes after compositionend, cancelled or not, and nothing is doubled", async (tab) => {
        await tab.run(`quire.reset("Ab\\n")`);
        await tab.run("quire.select([0], 2)");
        await tab.run("quire.start(); quire.update('c'); quire.update('cd'); quire.end('cd'); quire.after('insertFromComposition', 'cd', true)");
        await tab.wait(30);
        expect(await md(tab)).toBe("Abcd\n");
        expect(await shown(tab)).toBe("Abcd");
        // the same, where the browser will not let it be cancelled and writes it again: the page is put right from the model
        await tab.run("quire.start(); quire.update('e'); quire.end('e'); quire.after('insertFromComposition', 'e', false)");
        await tab.wait(30);
        expect(await md(tab)).toBe("Abcde\n");
        expect(await shown(tab)).toBe("Abcde");
    });

    inPage("Android, imitated: every key composes, a key is deleted by composing less, a word already written is composed again, and space commits", async (tab) => {
        await tab.run(`quire.reset("Say end\\n")`);
        await tab.run("quire.select([0], 4)");
        // h, e, l typed, the l taken back by composing less, then space: the keyboard ends the composition and types the space
        await tab.run("quire.start(); quire.update('h'); quire.update('he'); quire.update('hel'); quire.update('he'); quire.end('he')");
        expect(await tab.run<boolean>("quire.input('insertText', ' ')")).toBe(true);
        await tab.wait(30);
        expect(await md(tab)).toBe("Say he end\n");
        // the cursor put inside "hello" and a letter typed: the keyboard composes the whole word again
        await tab.run(`quire.reset("hello world\\n")`);
        await tab.run("quire.select([0], 3)");
        await tab.run(`(() => {
            quire.start();
            const holder = quire.element.querySelector("p");
            const word = document.createRange();
            word.setStart(holder.firstChild, 0);
            word.setEnd(holder.firstChild, 5);
            window.word = word;
        })()`);
        await tab.run("(() => { const r = window.word; r.deleteContents(); const n = document.createTextNode('helplo'); r.insertNode(n); document.getSelection().setBaseAndExtent(n, 4, n, 4); quire.end('helplo'); })()");
        await tab.wait(30);
        expect(await md(tab)).toBe("helplo world\n");
        expect(await shown(tab)).toBe("helplo world");
        // a delete the keyboard will not let be cancelled: the browser deletes, and the model takes it from the page
        await tab.run("quire.select([0], 6)");
        await tab.run(`quire.input("deleteContentBackward", null, [{ path: [0], offset: 5 }, { path: [0], offset: 6 }], false, () => { const t = quire.element.querySelector("p").firstChild; t.deleteData(5, 1); document.getSelection().setBaseAndExtent(t, 5, t, 5); })`);
        await tab.wait(30);
        expect(await md(tab)).toBe("helpl world\n");
        expect(await shown(tab)).toBe("helpl world");
    });

    inPage("a composition ended by a click elsewhere or by an arrow key keeps its text, once", async (tab) => {
        await tab.run(`quire.reset("One\\n\\nTwo\\n")`);
        await tab.run("quire.select([0], 3)");
        await tab.compose(["s", "す"], "す");
        await tab.run("quire.start(); quire.update('x'); quire.update('xy'); quire.end('xy'); quire.select([1], 0)");
        await tab.wait(30);
        expect(await md(tab)).toBe("Oneすxy\n\nTwo\n");
        await tab.run("quire.start(); quire.update('z'); quire.end('z')");
        await tab.press("ArrowRight");
        await tab.wait(30);
        expect(await md(tab)).toBe("Oneすxy\n\nzTwo\n");
        expect(await shown(tab)).toBe("Oneすxy\nzTwo");
    });

    inPage("the editor's own late drawing of a long code block waits while a composition is under way", async (tab) => {
        const code = "x".repeat(7000);
        await tab.run(`quire.reset(${JSON.stringify("```js\n" + code + "\n```\n")})`);
        await tab.run("quire.select([0], 3)");
        await tab.type("a");
        await tab.run("quire.start(); quire.update('か')");
        await tab.wait(400);
        await tab.run("quire.end('か')");
        await tab.wait(400);
        expect(await md(tab)).toBe("```js\nxxxaか" + code.slice(3) + "\n```\n");
    });
});

describe("every kind of input that changes text either changes the model or is cancelled", () => {
    inPage("a spelling fix replaces its range, or with no range the word at the cursor; yank types its text", async (tab) => {
        await tab.run(`quire.reset("I saw teh cat\\n")`);
        await tab.run("quire.select([0], 9)");
        expect(await tab.run<boolean>(`quire.input("insertReplacementText", "the", [{ path: [0], offset: 6 }, { path: [0], offset: 9 }])`)).toBe(true);
        expect(await md(tab)).toBe("I saw the cat\n");
        await tab.run("quire.select([0], 12)");
        await tab.run(`quire.input("insertReplacementText", "dog")`);
        expect(await md(tab)).toBe("I saw the dog\n");
        await tab.run("quire.select([0], 13)");
        await tab.run(`quire.input("insertFromYank", "!")`);
        expect(await md(tab)).toBe("I saw the dog!\n");
        expect(await shown(tab)).toBe("I saw the dog!");
    });

    inPage("the browser's Edit menu undoes and redoes through the editor's own history, and its Bold makes bold", async (tab) => {
        await tab.run(`quire.reset("")`);
        await tab.type("word");
        await tab.run(`quire.input("historyUndo", null)`);
        expect(await md(tab)).toBe("");
        await tab.run(`quire.input("historyRedo", null)`);
        expect(await md(tab)).toBe("word\n");
        await tab.run("quire.select([0], 0, 4)");
        await tab.run(`quire.input("formatBold", null)`);
        expect(await md(tab)).toBe("**word**\n");
    });

    inPage("Shift+Enter is a line break and Enter a paragraph; the deletes of words and lines and a delete over blocks change the model", async (tab) => {
        await tab.run(`quire.reset("one two\\n")`);
        await tab.run("quire.select([0], 3)");
        await tab.run(`quire.input("insertLineBreak", null)`);
        await tab.run(`quire.input("insertParagraph", null)`);
        expect(await tab.run<string[]>("quire.surface.getDocument().blocks.map((block) => block.runs.map((run) => run.kind === 'break' ? '|' : run.text).join(''))")).toEqual(["one|", " two"]);
        await tab.run(`quire.reset("one two three\\n\\nfour\\n")`);
        await tab.run("quire.select([0], 13)");
        await tab.run(`quire.input("deleteWordBackward", null)`);
        expect(await shown(tab)).toBe("one two \nfour");
        expect(await tab.run<string>("quire.surface.getDocument().blocks[0].runs[0].text")).toBe("one two ");
        await tab.run(`quire.input("deleteSoftLineBackward", null, [{ path: [0], offset: 0 }, { path: [0], offset: 8 }])`);
        expect(await shown(tab)).toBe("\nfour");
        expect(await tab.run<number>("quire.surface.getDocument().blocks[0].runs.length")).toBe(0);
        await tab.run(`quire.reset("one\\n\\ntwo\\n")`);
        await tab.run("quire.select([0], 1, 2, [1])");
        await tab.run(`quire.input("deleteContent", null)`);
        expect(await md(tab)).toBe("oo\n");
        expect(await shown(tab)).toBe("oo");
    });

    inPage("an input type the surface does not make is cancelled, so the page never shows what the model does not have", async (tab) => {
        await tab.run(`quire.reset("one\\n")`);
        await tab.run("quire.select([0], 3)");
        for (const type of ["insertTranspose", "insertFromPasteAsQuotation", "insertOrderedList", "formatJustifyCenter", "formatFontColor", "deleteByDrag", "insertFromDrop", "insertLink"]) {
            expect(await tab.run<boolean>(`quire.input(${JSON.stringify(type)}, null)`)).toBe(true);
        }
        expect(await md(tab)).toBe("one\n");
        // and one that could not be cancelled and changed a block the surface did not expect is drawn again from the model
        await tab.run(`quire.reset("one\\n\\ntwo\\n")`);
        await tab.run("quire.select([0], 3)");
        await tab.run(`quire.input("insertOrderedList", null, null, false, () => { quire.element.children[1].textContent = "changed"; quire.element.append(document.createElement("ol")); })`);
        expect(await md(tab)).toBe("one\n\ntwo\n");
        expect(await shown(tab)).toBe("one\ntwo");
    });

    inPage("Backspace and Delete take a whole character as a reader sees it: a flag, a joined family, an accent written after its letter", async (tab) => {
        await tab.run(`quire.reset("a🏳️‍🌈b👨‍👩‍👧c🇫🇷de\\u0301\\n")`);
        const length = await tab.run<number>("quire.surface.getDocument().blocks[0].runs[0].text.length");
        await tab.run(`quire.select([0], ${length})`);
        await tab.press("Backspace");
        expect(await md(tab)).toBe("a🏳️‍🌈b👨‍👩‍👧c🇫🇷d\n");
        await tab.press("ArrowLeft");
        await tab.wait(30);
        await tab.press("Backspace");
        expect(await md(tab)).toBe("a🏳️‍🌈b👨‍👩‍👧cd\n");
        await tab.run("quire.select([0], 1)");
        await tab.press("Delete");
        expect(await md(tab)).toBe("ab👨‍👩‍👧cd\n");
        await tab.run("quire.select([0], 2)");
        await tab.run(`quire.input("deleteContentForward", null)`);
        expect(await md(tab)).toBe("abcd\n");
    });

    inPage("copy, cut and a drop in a field inside the document are the field's own", async (tab) => {
        await tab.run(`quire.reset("\`\`\`js\\nlet a;\\n\`\`\`\\n\\nText here\\n")`);
        await tab.run("quire.select([1], 0, 4)");
        await tab.run(`(() => { const f = document.querySelector("[data-lang]"); f.focus(); f.select(); })()`);
        const cut = await tab.run<boolean>(`(() => { const data = new DataTransfer(); const e = new ClipboardEvent("cut", { clipboardData: data, bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(e); return e.defaultPrevented; })()`);
        expect(cut).toBe(false);
        const dropped = await tab.run<boolean>(`(() => { const data = new DataTransfer(); data.setData("text/plain", "dropped"); const e = new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(e); return e.defaultPrevented; })()`);
        expect(dropped).toBe(false);
        expect(await md(tab)).toBe("```js\nlet a;\n```\n\nText here\n");
    });
});

describe("pasting", () => {
    inPage("a copy from a spreadsheet or Word, which carries a picture of itself beside its text, pastes the text; a picture alone pastes the picture", async (tab) => {
        const paste = (html: string, text: string, picture: boolean) =>
            tab.run(`(() => {
                const data = new DataTransfer();
                if (${JSON.stringify(html)}) data.setData("text/html", ${JSON.stringify(html)});
                if (${JSON.stringify(text)}) data.setData("text/plain", ${JSON.stringify(text)});
                if (${picture}) data.items.add(new File([new Uint8Array([137, 80, 78, 71])], "copied.png", { type: "image/png" }));
                quire.element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
            })()`);
        await tab.run(`quire.reset("")`);
        await paste("<table><tr><td>a</td><td>b</td></tr></table>", "a\tb", true);
        await tab.wait(50);
        expect(await md(tab)).not.toContain("copied");
        expect(await md(tab)).toContain("a");
        await tab.run(`quire.reset("")`);
        await paste("", "", true);
        await tab.wait(50);
        expect(await md(tab)).toContain("copied.png");
        // Ctrl+Shift+V before a paste that turns out to be a picture does not make the next paste plain
        await tab.run(`quire.reset("")`);
        await tab.press("v", { ctrl: true, shift: true });
        await paste("", "", true);
        await tab.wait(50);
        await tab.run(`quire.reset("")`);
        await paste("<p><strong>bold</strong></p>", "bold", false);
        await tab.wait(50);
        expect(await md(tab)).toBe("**bold**\n");
    });

    inPage("an address pasted over selected words links them in one undo step; with nothing selected, or with Ctrl+Shift+V, or of another scheme, it is text", async (tab) => {
        const paste = (text: string) =>
            tab.run(`(() => {
                const data = new DataTransfer();
                data.setData("text/plain", ${JSON.stringify(text)});
                quire.element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
            })()`);
        await tab.run(`quire.reset("Read the notes here\\n")`);
        await tab.run("quire.select([0], 5, 14)");
        await paste(" https://example.com/notes\n");
        expect(await md(tab)).toBe("Read [the notes](https://example.com/notes) here\n");
        await tab.press("z", { ctrl: true });
        expect(await md(tab)).toBe("Read the notes here\n");
        await tab.run("quire.select([0], 5, 14)");
        await paste("javascript:alert(1)");
        expect(await md(tab)).toBe("Read javascript:alert(1) here\n");
        await tab.run(`quire.reset("Read the notes here\\n")`);
        await tab.run("quire.select([0], 5, 14)");
        // the key alone, as a script sends it: a real Ctrl+Shift+V would paste the empty clipboard first
        await tab.run(`quire.key({ key: "V", code: "KeyV", ctrlKey: true, shiftKey: true })`);
        await paste("https://example.com/notes");
        expect(await md(tab)).toBe("Read https://example.com/notes here\n");
        await tab.run(`quire.reset("")`);
        await tab.run("quire.select([0], 0)");
        await paste("https://example.com/notes");
        expect(await md(tab)).toBe("https://example.com/notes\n");
    });
});

describe("keyboard layouts", () => {
    inPage("AltGr types its character on French, Spanish and German layouts; Ctrl+Alt+digit is still a heading on a US layout", async (tab) => {
        await tab.run(`quire.reset("Text\\n")`);
        await tab.run("quire.select([0], 4)");
        // Windows reports AltGr as Ctrl and Alt; the key is the character it types
        const typed: [string, string][] = [
            ["@", "Digit0"], // French AltGr+0
            ["#", "Digit3"], // French AltGr+3
            ["{", "Digit4"], // French AltGr+4
            ["|", "Digit1"], // Spanish AltGr+1
            ["~", "Digit4"], // Spanish AltGr+4
            ["²", "Digit2"], // German AltGr+2
            ["€", "KeyE"], // German AltGr+E
            ["µ", "KeyM"], // German AltGr+M
        ];
        for (const [key, code] of typed) {
            expect(await tab.run<boolean>(`quire.key({ key: ${JSON.stringify(key)}, code: ${JSON.stringify(code)}, ctrlKey: true, altKey: true })`)).toBe(false);
        }
        expect(await md(tab)).toBe("Text\n");
        // a US layout's Ctrl+Alt+2 is Heading 2
        expect(await tab.run<boolean>(`quire.key({ key: "2", code: "Digit2", ctrlKey: true, altKey: true })`)).toBe(true);
        expect(await md(tab)).toBe("## Text\n");
        // on AZERTY Ctrl+Alt with the key in the digit row's place of 1 types nothing of its own here, and is still found by its place
        expect(await tab.run<boolean>(`quire.key({ key: "&", code: "Digit1", ctrlKey: true, altKey: false })`)).toBe(false);
    });

    inPage("letters are matched by the letter the key types: Dvorak's Ctrl+X is not bold, and its Ctrl+B is", async (tab) => {
        await tab.run(`quire.reset("word\\n")`);
        await tab.run("quire.select([0], 0, 4)");
        // Dvorak: the key that types x sits where QWERTY has b
        expect(await tab.run<boolean>(`quire.key({ key: "x", code: "KeyB", ctrlKey: true })`)).toBe(false);
        expect(await md(tab)).toBe("word\n");
        // and the key that types b sits where QWERTY has n
        expect(await tab.run<boolean>(`quire.key({ key: "b", code: "KeyN", ctrlKey: true })`)).toBe(true);
        expect(await md(tab)).toBe("**word**\n");
        // AZERTY: Ctrl+Shift with the key that types a full stop there (Shift and the semicolon key) is superscript
        await tab.run(`quire.reset("word\\n")`);
        await tab.run("quire.select([0], 0, 4)");
        expect(await tab.run<boolean>(`quire.key({ key: ".", code: "Comma", ctrlKey: true, shiftKey: true })`)).toBe(true);
        expect(await md(tab)).toBe("<sup>word</sup>\n");
        // a Russian layout: the key in B's place types и, and is bold by its place
        await tab.run(`quire.reset("word\\n")`);
        await tab.run("quire.select([0], 0, 4)");
        expect(await tab.run<boolean>(`quire.key({ key: "и", code: "KeyB", ctrlKey: true })`)).toBe(true);
        expect(await md(tab)).toBe("**word**\n");
    });
});

test("AltGr is told from a shortcut on every layout imitated", () => {
    const press = (key: string, code: string, held: { ctrl?: boolean; alt?: boolean; meta?: boolean; graph?: boolean } = {}) => ({ key, code, ctrlKey: !!held.ctrl, altKey: !!held.alt, metaKey: !!held.meta, getModifierState: (name: string) => name === "AltGraph" && !!held.graph });
    // US: Ctrl+Alt+1 is a shortcut; French, Spanish, German AltGr is typing
    expect(altGraph(press("1", "Digit1", { ctrl: true, alt: true }), false)).toBe(false);
    expect(altGraph(press("@", "Digit0", { ctrl: true, alt: true }), false)).toBe(true);
    expect(altGraph(press("|", "Digit1", { ctrl: true, alt: true }), false)).toBe(true);
    expect(altGraph(press("€", "KeyE", { ctrl: true, alt: true }), false)).toBe(true);
    // Linux and others say AltGraph outright
    expect(altGraph(press("@", "KeyQ", { graph: true }), false)).toBe(true);
    // a Mac's Option is not AltGr
    expect(altGraph(press("¡", "Digit1", { ctrl: true, alt: true }), true)).toBe(false);
    // letters by what they type, digits with Alt by their place, the rest by character
    expect(shortcutKey(press("x", "KeyB", { ctrl: true }), true)).toBe("x");
    expect(shortcutKey(press("B", "KeyB", { ctrl: true }), true)).toBe("b");
    expect(shortcutKey(press("и", "KeyB", { ctrl: true }), true)).toBe("b");
    expect(shortcutKey(press("¡", "Digit1", { meta: true, alt: true }), true)).toBe("1");
    expect(shortcutKey(press(".", "Comma", { ctrl: true }), true)).toBe(".");
    expect(shortcutKey(press("Enter", "Enter", { ctrl: true }), true)).toBe("Enter");
});

describe("selections between the page and the model", () => {
    inPage("Select All then typing replaces everything, with a block that cannot be written in at either end", async (tab) => {
        for (const markdown of ["***\n\nOne\n\nTwo\n\n***\n", "![p](data:image/gif;base64,R0lGODlhAQABAAAAACw=)\n\nOne\n", "One\n\n<!-- toc -->\n\n- [One](#one)\n"]) {
            await tab.run(`quire.reset(${JSON.stringify(markdown)})`);
            await tab.press("a", { ctrl: true });
            await tab.wait(30);
            const last = await tab.run<number>("quire.surface.getDocument().blocks.length - 1");
            const all = await tab.run<{ anchor: { path: number[]; offset: number }; focus: { path: number[] } }>("quire.selection()");
            expect(all.anchor).toEqual({ path: [0], offset: 0 });
            expect(all.focus.path[0]).toBe(last);
            await tab.type("x");
            await tab.wait(30);
            expect(await md(tab)).not.toMatch(/One|Two/);
            expect(await md(tab)).toContain("x");
        }
        await tab.run(`quire.reset("One\\n\\nTwo\\n")`);
        await tab.press("a", { ctrl: true });
        await tab.type("x");
        expect(await md(tab)).toBe("x\n");
        expect(await shown(tab)).toBe("x");
    });

    inPage("Shift and the arrows across a block that cannot be written in, then a key, leave valid text", async (tab) => {
        await tab.run(`quire.reset("One\\n\\n***\\n\\nTwo\\n")`);
        await tab.run("quire.select([0], 1)");
        await tab.press("ArrowDown", { shift: true });
        await tab.press("ArrowDown", { shift: true });
        await tab.wait(50);
        const selection = await tab.run<{ anchor: { path: number[] }; focus: { path: number[] } }>("quire.selection()");
        expect(selection.anchor.path).toEqual([0]);
        expect(selection.focus.path).toEqual([2]);
        await tab.type("x");
        await tab.wait(30);
        // the second Shift+ArrowDown reaches the end of the last line
        expect(await md(tab)).toBe("Ox\n");
        expect(await shown(tab)).toBe("Ox");
    });

    inPage("a drag across blocks selects what it crossed, and a key replaces it", async (tab) => {
        await tab.run(`quire.reset("First line\\n\\nSecond line\\n\\nThird line\\n")`);
        const point = (path: number, offset: number) => tab.run<{ x: number; y: number }>(`(() => { const r = quire.surface.rangeOf({ path: [${path}], offset: ${offset} }, { path: [${path}], offset: ${offset} }).getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2 }; })()`);
        await tab.drag(await point(0, 2), await point(2, 3));
        await tab.wait(50);
        expect(await tab.run("quire.selection()")).toEqual({ anchor: { path: [0], offset: 2 }, focus: { path: [2], offset: 3 } });
        await tab.type("x");
        await tab.wait(30);
        expect(await md(tab)).toBe("Fixrd line\n");
        expect(await shown(tab)).toBe("Fixrd line");
    });

    inPage("a triple click's selection, which the browser runs on to the start of the next block, replaces the one paragraph", async (tab) => {
        await tab.run(`quire.reset("One two\\n\\nThree\\n")`);
        // Chrome's triple click, imitated: the press with a count of three, then the selection it makes
        await tab.run(`(() => {
            const [first, second] = quire.element.children;
            first.dispatchEvent(new MouseEvent("mousedown", { detail: 3, bubbles: true, cancelable: true }));
            document.getSelection().setBaseAndExtent(first.firstChild, 0, second, 0);
            first.dispatchEvent(new MouseEvent("mouseup", { detail: 3, bubbles: true }));
        })()`);
        await tab.wait(50);
        await tab.type("x");
        await tab.wait(30);
        expect(await md(tab)).toBe("x\n\nThree\n");
    });

    inPage("in an empty block, in right-to-left text and over an emoji of several code points the page's cursor and the model's agree", async (tab) => {
        await tab.run(`quire.reset("")`);
        await tab.type("a");
        await tab.press("Enter");
        await tab.press("Enter");
        await tab.type("b");
        await tab.press("ArrowUp");
        await tab.wait(30);
        expect((await tab.run<{ focus: { path: number[]; offset: number } }>("quire.selection()")).focus).toEqual({ path: [1], offset: 0 });
        await tab.type("m");
        expect(await shown(tab)).toBe("a\nm\nb");
        // right to left: the arrows move through the text in its own order, and the model follows
        await tab.run(`quire.reset("שלום עולם\\n")`);
        await tab.run("quire.select([0], 4)");
        await tab.press("ArrowLeft");
        await tab.wait(30);
        const moved = await tab.run<{ model: number; page: number }>(`(() => { const s = document.getSelection(); const r = document.createRange(); r.setStart(quire.element.firstChild, 0); r.setEnd(s.focusNode, s.focusOffset); return { model: quire.selection().focus.offset, page: r.toString().length }; })()`);
        expect(moved.model).toBe(moved.page);
        expect(moved.model).not.toBe(4);
        await tab.type("x");
        expect(await md(tab)).toBe("שלום עולם".slice(0, moved.model) + "x" + "שלום עולם".slice(moved.model) + "\n");
        // a joined emoji is selected and replaced whole
        await tab.run(`quire.reset("a👨‍👩‍👧b\\n")`);
        await tab.run("quire.select([0], 9)");
        await tab.press("ArrowLeft", { shift: true });
        await tab.wait(30);
        await tab.type("x");
        expect(await md(tab)).toBe("axb\n");
    });
});

if (!chromium()) console.warn("surface-input.test.ts: no Chromium on this machine, so input methods and layouts were not tried.");
