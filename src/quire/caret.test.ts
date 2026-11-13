// The caret's colours: one for each blink, going round (caret.ts).

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium } from "../../scripts/browser";
import { blinkColour, contrast, FLAG, hexRgb, luminance, needsEdge } from "./caret";

describe("the lesbian flag", () => {
    test("is the caret's five colours, from the top", () => {
        expect([...FLAG]).toEqual(["#D52D00", "#FF9A56", "#FFFFFF", "#D362A4", "#A30262"]);
        expect(FLAG.map((_, index) => blinkColour(FLAG, index + FLAG.length))).toEqual([...FLAG]);
    });

    test("contrast is measured as WCAG measures it", () => {
        expect(luminance([0, 0, 0])).toBe(0);
        expect(luminance([255, 255, 255])).toBeCloseTo(1, 6);
        expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 6);
        expect(contrast(hexRgb("#777777"), [255, 255, 255])).toBeCloseTo(4.48, 2);
        expect(hexRgb("#D362A4")).toEqual([211, 98, 164]);
    });

    test("on the dark sheet the darkest colour needs an edge, and no dark sheet could do without one", () => {
        // the sheet as the site draws it, oklch(0.259 0.051 300), measured in the browser
        const sheet: [number, number, number] = [40, 29, 57];
        expect(FLAG.filter((colour) => needsEdge(hexRgb(colour), sheet))).toEqual(["#A30262"]);
        expect(contrast(hexRgb("#A30262"), [0, 0, 0])).toBeLessThan(3);
        expect(contrast(hexRgb("#FFFFFF"), sheet)).toBeGreaterThan(10);
    });
});

describe("blinkColour", () => {
    test("goes round the colours, one per blink", () => {
        const colours = ["a", "b", "c"];
        expect([0, 1, 2, 3, 4, 7].map((index) => blinkColour(colours, index))).toEqual(["a", "b", "c", "a", "b", "b"]);
    });

    test("one colour stays that colour", () => {
        expect(blinkColour(["accent"], 5)).toBe("accent");
    });
});

test.skipIf(!chromium())(
    "the text's caret is not drawn while a field inside the document has the keyboard",
    async () => {
        const folder = await mkdtemp(join(tmpdir(), "quire-caret-"));
        const tab = await browser({ width: 900, height: 700 });
        try {
            await Bun.write(
                `${folder}/page.ts`,
                `import { createSurface } from "${import.meta.dir}/surface.ts";
                import { createCaret } from "${import.meta.dir}/caret.ts";
                import { read } from "${import.meta.dir}/read.ts";
                const frame = document.querySelector("#frame");
                const sheet = document.querySelector("#sheet");
                const surface = createSurface(sheet, read("Text\\n\\n\u0060\u0060\u0060js\\nlet a;\\n\u0060\u0060\u0060\\n"));
                createCaret(sheet, frame);
                surface.focus();`,
            );
            const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
            if (!built.success) throw new Error(built.logs.join("\n"));
            await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><div id="frame" style="position:relative"><div id="sheet"></div></div><script type="module">${await built.outputs[0]!.text()}</script>`);
            await tab.open(`file://${folder}/page.html`, 300);
            const shown = () => tab.run<boolean>("document.querySelector('.quire-caret').classList.contains('shown')");
            await tab.press("End");
            await tab.wait(100);
            expect(await shown()).toBe(true);
            await tab.run("document.querySelector('[data-lang]').focus()");
            await tab.type("x");
            await tab.wait(100);
            expect(await shown()).toBe(false);
            expect(tab.errors).toEqual([]);
        } finally {
            await tab.close();
            await rm(folder, { recursive: true, force: true });
        }
    },
    60_000,
);
