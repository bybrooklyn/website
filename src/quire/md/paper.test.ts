// What the paper and the zoom are held to: each paper's size, turned for landscape; the @page rule
// print is given; a page setup kept only by a `.quire` document; zoom steps that stop at half and
// twice; and fitting a sheet to the room it has. The sheet itself is used in editor.test.ts.

import { expect, test } from "bun:test";
import { fitZoom, pageRule, wantedZoom, paperSize, percent, setPage, setupChoices, stepZoom, ZOOMS } from "./paper";
import { read } from "./read";
import { PAGE } from "./styling";

test("each paper is its size in millimetres, and landscape turns it on its side", () => {
    expect(paperSize({ size: "A4", orientation: "portrait", margins: 25 })).toEqual({ width: 210, height: 297 });
    expect(paperSize({ size: "Letter", orientation: "landscape", margins: 25 })).toEqual({ width: 279.4, height: 215.9 });
    expect(paperSize({ size: "A5", orientation: "portrait", margins: 25 })).toEqual({ width: 148, height: 210 });
});

test("print is given the page's paper, which way up, and its margins", () => {
    expect(pageRule({ size: "Letter", orientation: "landscape", margins: 12.7 })).toBe("@page { size: Letter landscape; margin: 12.7mm; }");
});

test("a page setup is kept by a .quire document, and a Markdown file has none to keep", () => {
    const rich = { ...read("Words.\n"), quire: { page: PAGE, notes: null } };
    expect(setPage(rich, { ...PAGE, size: "A5" }).quire?.page.size).toBe("A5");
    const plain = read("Words.\n");
    expect(setPage(plain, { ...PAGE, size: "A5" })).toBe(plain);
});

test("zoom steps go from half to twice the size and stop there, and a zoom between steps goes to the next one", () => {
    expect(ZOOMS[0]).toBe(0.5);
    expect(ZOOMS[ZOOMS.length - 1]).toBe(2);
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(1.3, 1)).toBe(1.5);
    expect(stepZoom(1.3, -1)).toBe(1.25);
    expect(percent(0.667)).toBe("67%");
});

test("fitting the width fills the room, never past twice or below a quarter, and is 1 with nothing to measure", () => {
    expect(fitZoom(794, 794)).toBe(1);
    expect(fitZoom(397, 794)).toBe(0.5);
    expect(fitZoom(5000, 794)).toBe(2);
    expect(fitZoom(100, 794)).toBe(0.25);
    expect(fitZoom(0, 794)).toBe(1);
});

test("page setup offers the three papers, both orientations and three margins with their sizes, each on when it is what the page has, and says only what changes", () => {
    const groups = setupChoices({ size: "Letter", orientation: "landscape", margins: 25 });
    expect(groups.map((group) => group.label)).toEqual(["Paper", "Orientation", "Margins"]);
    expect(groups.flatMap((group) => group.choices.filter((choice) => choice.on).map((choice) => choice.label))).toEqual(["Letter", "Landscape", "Normal"]);
    expect(groups[2]!.choices.map((choice) => `${choice.label} ${choice.note}`)).toEqual(["Narrow 12.7 mm", "Normal 25 mm", "Wide 38 mm"]);
    expect(groups[0]!.choices.find((choice) => choice.label === "A5")!.change).toEqual({ size: "A5" });
    expect(groups[2]!.choices.find((choice) => choice.label === "Narrow")!.change).toEqual({ margins: 12.7 });
});

test("print is given the header, footer and page number in the page's margin boxes, quoted safely", () => {
    const rule = pageRule({ size: "A4", orientation: "portrait", margins: 25, header: 'Say "hi" \\ there', footer: "Foot", numbers: true });
    expect(rule).toContain('@top-center { content: "Say \\"hi\\" \\\\ there";');
    expect(rule).toContain('@bottom-center { content: "Foot";');
    expect(rule).toContain("@bottom-right { content: counter(page);");
    expect(rule.startsWith("@page { size: A4 portrait; margin: 25mm; ")).toBe(true);
});

test("in writing view the usual zoom is the text at its own size and there is no fitting; in page view the usual is the paper, less to fit", () => {
    expect(wantedZoom("auto", 0.7, false)).toBe(1);
    expect(wantedZoom("fit", 1.6, false)).toBe(1);
    expect(wantedZoom(1.5, 0.7, false)).toBe(1.5);
    expect(wantedZoom("auto", 0.7, true)).toBe(0.7);
    expect(wantedZoom("auto", 1.6, true)).toBe(1);
    expect(wantedZoom("fit", 1.6, true)).toBe(1.6);
});
