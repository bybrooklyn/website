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

const here = import.meta.dir;

// The page: one surface, and an imitation of an input method that changes the page as a browser does.
const page = `
import { createSurface } from "${here}/surface.ts";
import { read } from "${here}/read.ts";
import { write } from "${here}/write.ts";
const element = document.querySelector("#editor");
const surface = createSurface(element, read(""));
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
        ["a picture's alt text", "![dot](data:image/gif;base64,R0lGODlhAQABAAAAACw=)\n\nText\n", "[data-alt]", "![dot](data:image/gif;base64,R0lGODlhAQABAAAAACw=)\n\nText\n"],
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

describe("every kind of input that changes text either changes the model or is cancelled", () => {
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

if (!chromium()) console.warn("surface-input.test.ts: no Chromium on this machine, so input methods and layouts were not tried.");
