// What the slash way into the palette is held to: typing after the slash narrows it to the right things, it knows
// when the slash is gone, and choosing takes the slash away and makes the block. Run with
// `bun test src/quire`.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../../scripts/browser";
import { insertText, textAt } from "./document";
import { caret } from "./keys";
import { read } from "./read";
import { chooseSlash, filterSlash, SLASH_ITEMS, slashQuery } from "./slash";
import { write } from "./write";

const keys = (query: string) => filterSlash(query).map((item) => item.key);

test("with nothing typed after the slash every item is offered", () => {
    expect([...keys("")].sort()).toEqual(SLASH_ITEMS.map((item) => item.key).sort());
    expect(keys("   ")).toHaveLength(SLASH_ITEMS.length);
});

test("typing narrows the menu by name first, then by other words", () => {
    expect(keys("head")).toEqual(["heading1", "heading2", "heading3"]);
    expect(keys("h2")).toEqual(["heading2"]);
    expect(keys("list")).toEqual(["bullet", "number", "definitions"]);
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

const choose = (source: string, path: number[], key: string, mdx = false) => {
    const doc = read(source, { mdx });
    return chooseSlash({ doc, selection: caret(path, textAt(doc, path).length) }, SLASH_ITEMS.find((each) => each.key === key)!);
};

test("the further blocks are made from the slash menu, the cursor left where the writing goes", () => {
    const callout = choose("/call\n", [0], "callout");
    expect(callout.doc.blocks[0]).toMatchObject({ kind: "quote", callout: "NOTE" });
    expect(callout.selection).toEqual(caret([0, 0], 0));
    expect(write(insertText(callout.doc, callout.selection.focus, "Hi"))).toBe("> [!NOTE]\n> Hi\n");
    const fold = choose("/fold\n", [0], "details");
    expect(write(insertText(fold.doc, fold.selection.focus, "Hidden"))).toBe("<details>\n<summary></summary>\n\nHidden\n\n</details>\n");
    const terms = choose("/def\n", [0], "definitions");
    expect(terms.selection).toEqual(caret([0, 0, 0], 0));
    expect(write(insertText(insertText(terms.doc, { path: [0, 0, 1], offset: 0 }, "Meaning"), terms.selection.focus, "Term"))).toBe("Term\n: Meaning\n");
    const maths = choose("/math\n", [0], "maths");
    expect(write(insertText(maths.doc, maths.selection.focus, "x^2"))).toBe("$$\nx^2\n$$\n");
    const chart = choose("/dia\n", [0], "diagram");
    expect(write(chart.doc)).toBe("```mermaid\nflowchart TD\n    A[Start] --> B[Next]\n```\n");
});

test("the site's components are offered in an MDX file alone, and made with the import they need", () => {
    expect(filterSlash("", false).some((each) => each.mdx)).toBe(false);
    expect(filterSlash("fig", true).map((each) => each.key)).toEqual(["figure"]);
    const figure = choose('---\ntitle: x\n---\n\nimport Embed from "../../components/Embed.astro";\n\nText.\n\n/fig\n', [2], "figure", true);
    expect(write(figure.doc)).toBe('---\ntitle: x\n---\n\nimport Embed from "../../components/Embed.astro";\nimport Figure from "../../components/Figure.astro";\n\nText.\n\n<Figure src="" alt="" width={960} height={540} />\n');
    const timeline = choose("Text.\n\n/time\n", [1], "timeline", true);
    expect(write(insertText(timeline.doc, timeline.selection.focus, "It began."))).toBe('import Timeline from "../../components/Timeline.astro";\nimport Moment from "../../components/Moment.astro";\n\nText.\n\n<Timeline>\n\n<Moment when="">\n\nIt began.\n\n</Moment>\n\n</Timeline>\n');
    // a component already imported is not imported again
    const again = choose('import Terminal from "../../components/Terminal.astro";\n\n/term\n', [1], "terminal", true);
    expect(write(again.doc)).toBe('import Terminal from "../../components/Terminal.astro";\n\n<Terminal cast="" title="" />\n');
});

test.skipIf(!chromium())(
    "with the slash menu or the emoji list open, the text points a screen reader at the active line, which moves with the arrows, and lets go when it closes",
    async () => {
        const folder = await mkdtemp(join(tmpdir(), "quire-slash-"));
        const tab = await browser({ width: 1000, height: 800 });
        try {
            await Bun.write(
                `${folder}/page.ts`,
                `import { createSurface } from "${import.meta.dir}/surface.ts";
                import { createSlashMenu } from "${import.meta.dir}/slash-menu.ts";
                import { createEmojiPicker } from "${import.meta.dir}/emoji-picker.ts";
                import { read } from "${import.meta.dir}/read.ts";
                const sheet = document.querySelector("#sheet");
                const surface = createSurface(sheet, read(""));
                createSlashMenu(surface);
                createEmojiPicker(surface);
                surface.focus();
                window.surface = surface;`,
            );
            const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
            if (!built.success) throw new Error(built.logs.join("\n"));
            await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><div id="sheet"></div><script type="module">${await built.outputs[0]!.text()}</script>`);
            await tab.open(`file://${folder}/page.html`, 300);
            const pointed = () => tab.run<{ id: string | null; role: string | null; text: string | null; list: string | null }>(`(() => { const id = surface.element.getAttribute("aria-activedescendant"); const line = id && document.getElementById(id); return { id, role: line ? line.getAttribute("role") : null, text: line ? line.textContent : null, list: surface.element.getAttribute("aria-controls") && document.getElementById(surface.element.getAttribute("aria-controls")).getAttribute("role") }; })()`);
            await tab.type("/");
            await tab.wait(100);
            const first = await pointed();
            expect(first.role).toBe("option");
            expect(first.list).toBe("listbox");
            await tab.press("ArrowDown");
            const second = await pointed();
            expect(second.role).toBe("option");
            expect(second.text).not.toBe(first.text);
            await tab.press("Escape");
            await tab.wait(100);
            expect((await pointed()).id).toBeNull();
            // the emoji list, the same way
            await tab.press("Backspace");
            await tab.type(":smi");
            await tab.wait(100);
            expect((await pointed()).role).toBe("option");
            await tab.press("Escape");
            await tab.wait(100);
            expect((await pointed()).id).toBeNull();
            expect(tab.errors).toEqual([]);
        } finally {
            await tab.close();
            await rm(folder, { recursive: true, force: true });
        }
    },
    60_000,
);
