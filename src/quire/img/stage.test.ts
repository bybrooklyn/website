// What the stage is held to: a mark's thickness follows the pen and the picture's size; a word read
// from the picture is covered by its box and margin, a run by one cover a line, and a run's text keeps
// its lines; and in
// headless Chromium, by real keys and drags, the crop's frame is nudged by the arrows (ten pixels with
// Shift), held to a square from the strip, and set with Enter; zooming by the keys goes to one to one
// and back to fitted; a mark picked is moved by the arrows and removed with Delete, and undo brings
// it back; Escape leaves the tool. Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { coveredBy, findingCovers, lensBeside, onWords, placeWords, runCovers, runText, sizesFor, thickness } from "./stage";

test("a highlighter laid on words read runs along their line through its middle, a tenth of its height past the first and last word, as thick as the line and a tenth more, a slanted line too", () => {
    const line = { text: "", sure: 1, box: { at: { x: 100, y: 50 }, along: { x: 1, y: 0 }, length: 300, height: 20 }, words: [] };
    const word = (x: number, length: number) => ({ text: "w", sure: 1, line: 0, box: { at: { x, y: 52 }, along: { x: 1, y: 0 }, length, height: 16 } });
    expect(onWords(line, [word(110, 40), word(160, 60)])).toEqual({ from: { x: 108, y: 60 }, to: { x: 222, y: 60 }, thickness: 22 });
    expect(onWords(line, [])).toBeUndefined();
    // a line slanted 90 degrees: the stroke runs down it
    const down = { ...line, box: { at: { x: 100, y: 50 }, along: { x: 0, y: 1 }, length: 300, height: 20 } };
    const laid = onWords(down, [{ text: "w", sure: 1, line: 0, box: { at: { x: 98, y: 60 }, along: { x: 0, y: 1 }, length: 40, height: 16 } }])!;
    expect(laid.from.x).toBeCloseTo(90);
    expect(laid.from.y).toBeCloseTo(58);
    expect(laid.to.y).toBeCloseTo(102);
});

test("a lens put down by a press goes half a lens up and to the right of what it looks at, or the first other side where it lies whole on the picture", () => {
    const room = { x: 0, y: 0, width: 1000, height: 800 };
    expect(lensBeside({ x: 500, y: 400 }, 100, room)).toEqual({ x: 650, y: 250 });
    expect(lensBeside({ x: 900, y: 400 }, 100, room)).toEqual({ x: 750, y: 250 });
    expect(lensBeside({ x: 500, y: 100 }, 100, room)).toEqual({ x: 650, y: 250 });
    expect(lensBeside({ x: 900, y: 100 }, 100, room)).toEqual({ x: 750, y: 250 });
});

test("new marks' sizes follow the pen and the picture's longer side: a number's circle, a highlighter's stroke, a text's outline, a lens", () => {
    const sizes = sizesFor({ color: "#000000", weight: 0.005, outlineWeight: 0.08 }, { width: 1200, height: 700 });
    expect(sizes).toEqual({ line: 6, text: 36, outline: 3, number: 42, highlight: 24, lens: 96 });
    expect(sizesFor({ color: "#000000", weight: 0.003 }, { width: 100, height: 50 }).lens).toBe(12);
});

/** Two lines of words, each word 40 wide and 20 high, the second line 60 below the first. */
const LINES = [0, 1].map((row) => ({ text: "", sure: 1, box: { at: { x: 0, y: row * 60 }, along: { x: 1, y: 0 }, length: 300, height: 30 }, words: ["one", "two", "three"].map((text, at) => ({ text: `${text}${row}`, sure: 1, line: row, box: { at: { x: 10 + at * 60, y: 5 + row * 60 }, along: { x: 1, y: 0 }, length: 40, height: 20 } })) }));

test("something that looks private is covered one cover a line, edge to edge from its first word there to its last, and a rectangle inside a cover is known as covered", () => {
    const words = placeWords(LINES);
    // the first line's three words, as a phone number of three groups would be: one cover, not three with gaps
    expect(findingCovers(words, [0, 1, 2])).toEqual([{ x: 7, y: 2, width: 166, height: 26 }]);
    // a thing over two lines: one cover a line
    expect(findingCovers(words, [2, 3, 4])).toEqual([{ x: 127, y: 2, width: 46, height: 26 }, { x: 7, y: 62, width: 106, height: 26 }]);
    // words of the thing that are not side by side on a line still give one cover, edge to edge
    expect(findingCovers(words, [0, 2])).toEqual([{ x: 7, y: 2, width: 166, height: 26 }]);
    expect(coveredBy([{ x: 0, y: 0, width: 200, height: 30 }], words[1]!.cover)).toBe(true);
    expect(coveredBy([{ x: 0, y: 0, width: 60, height: 30 }], words[1]!.cover)).toBe(false);
});

test("a word's cover is its box grown by a tenth of its line's height, a run's covers are one a line round its words, and a run's text keeps its lines", () => {
    const words = placeWords(LINES);
    expect(words).toHaveLength(6);
    // a tenth of 30 is 3
    expect(words[0]!.cover).toEqual({ x: 7, y: 2, width: 46, height: 26 });
    expect(runCovers(words, [0, 1])).toEqual([{ x: 7, y: 2, width: 106, height: 26 }]);
    expect(runCovers(words, [1, 2, 3])).toEqual([{ x: 67, y: 2, width: 106, height: 26 }, { x: 7, y: 62, width: 46, height: 26 }]);
    expect(runCovers(words, [0, 2])).toHaveLength(2);
    expect(runText(words, 4, 1)).toBe("two0 three0\none1 two1");
});

test("a mark's thickness follows the pen and the picture's longer side, never thinner than two pixels", () => {
    expect(thickness({ color: "#000000", weight: 0.005 }, { width: 4000, height: 3000 })).toBe(20);
    expect(thickness({ color: "#000000", weight: 0.003 }, { width: 300, height: 200 })).toBe(2);
});

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-stage");
    if (!page) console.warn("stage browser test skipped: needs a Chromium");
});
afterAll(async () => {
    await page?.close();
});
const frameOf = () => page!.tab.run<{ x: number; y: number; width: number; height: number }>("window.app.editing().stage.frame()");
const stepsOf = () => page!.tab.run<{ type: string; id: string; from?: { x: number }; rect?: { x: number; y: number; width: number; height: number } }[]>("window.app.editing().steps()");

test("the crop's frame is nudged by the arrows, held to a square from the strip, and set with Enter", async () => {
    if (!page) return;
    await page.paste("screenshot");
    expect(await frameOf()).toEqual({ x: 0, y: 0, width: 1200, height: 700 });
    // a corner dragged in first, so that the frame has room to move
    const corner = await page.onScreen(1200, 700);
    const to = await page.onScreen(900, 500);
    await page.tab.drag(corner, to, 6);
    await page.tab.press("ArrowRight");
    await page.tab.press("ArrowDown", { shift: true });
    const nudged = await frameOf();
    expect([nudged.x, nudged.y]).toEqual([1, 10]);
    const square = await page.tab.run<{ x: number; y: number }>("(() => { const box = document.querySelector('.quire-img-strip [aria-label=\"Square shape\"]').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()");
    await page.tab.click(square.x, square.y);
    const held = await frameOf();
    expect(held.width).toBe(held.height);
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("Enter");
    const steps = await stepsOf();
    expect(steps.map((step) => step.type)).toEqual(["crop"]);
    expect(steps[0]!.rect!.width).toBe(held.width);
    expect(await page.tab.run("window.app.editing().stage.tool()")).toBe("none");
}, 30_000);

test("turned by the crop's dial, a cover, an arrow and words read stay where they were on the picture: pressed where they now are they are picked or hidden, a new box is upright on the screen, and the export draws each in its place", async () => {
    if (!page) return;
    await page.paste("screenshot");
    // a cover over the blue button (60 to 240 across, 260 to 308 down) and an arrow, made before turning
    await page.tab.press("r");
    await page.tab.drag(await page.onScreen(70, 265), await page.onScreen(230, 303), 6);
    await page.tab.press("a");
    await page.tab.drag(await page.onScreen(700, 400), await page.onScreen(1000, 400), 6);
    const before = await stepsOf();
    expect(before.map((step) => step.type)).toEqual(["cover", "arrow"]);
    // eight degrees by the dial's keys, a degree a press with Shift
    await page.tab.press("c");
    await page.tab.run("document.querySelector('.quire-img-dial').focus()");
    for (let at = 0; at < 8; at++) await page.tab.press("ArrowRight", { shift: true });
    const steps = await page.tab.run<{ type: string; angle?: number }[]>("window.app.editing().steps()");
    expect(steps.find((step) => step.type === "turn")?.angle).toBe(8);
    expect(await page.tab.run("document.querySelector('.quire-img-dial-said').textContent")).toBe("8.0°");
    // the frame is the largest upright rectangle inside the turned picture
    const frame = await frameOf();
    expect(frame.width).toBeLessThan(1200);
    // outside the turned picture nothing is drawn, so the room shows; the picture outside the frame is dimmed, not hidden
    await page.tab.wait(600);
    // read in the frame the stage draws in, before the canvas is shown and cleared: a paint asked for, then a frame after it
    const seenAround = await page.tab.run<{ outside: number; dimmed: number[]; whole: boolean }>(`new Promise((done) => { window.app.editing().stage.zoom(1); requestAnimationFrame(() => done((() => {
        const stage = window.app.editing().stage;
        const room = document.querySelector(".quire-img-stage");
        const corners = [[0, 0], [1200, 0], [1200, 700], [0, 700]].map(([x, y]) => stage.toScreen({ x, y }));
        const left = Math.min(...corners.map((c) => c.x)), top = Math.min(...corners.map((c) => c.y));
        const right = Math.max(...corners.map((c) => c.x)), bottom = Math.max(...corners.map((c) => c.y));
        const canvas = document.querySelector(".quire-img-canvas");
        const copy = new OffscreenCanvas(canvas.width, canvas.height).getContext("2d");
        copy.drawImage(canvas, 0, 0);
        const ratio = canvas.width / room.clientWidth;
        const at = (x, y) => [...copy.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data];
        // the box round the turned picture's top left corner, just inside the box: off the picture
        const inner = stage.toScreen({ x: 30, y: 650 });
        return { outside: at(left + 3, top + 3)[3], dimmed: at(inner.x, inner.y), whole: left >= 0 && top >= 0 && right <= room.clientWidth && bottom <= room.clientHeight };
    })())); })`);
    expect(seenAround.outside).toBe(0);
    expect(seenAround.dimmed[3]).toBe(255);
    expect(seenAround.whole).toBe(true);
    await page.tab.run("document.querySelector('.quire-img-stage').focus()");
    await page.tab.press("Escape");
    // the cover's middle, in the original's pixels, is where it is on the screen now, turned; pressed there it is picked
    const cover = before[0]!;
    const middle = { x: cover.rect!.x + cover.rect!.width / 2, y: cover.rect!.y + cover.rect!.height / 2 };
    const seen = await page.onScreen(middle.x, middle.y);
    const turned = await page.tab.run<{ x: number; y: number }>(`(() => { const s = window.app.editing().stage; const a = s.toScreen({ x: 600, y: 350 }); const b = s.toScreen({ x: 700, y: 350 }); return { x: b.x - a.x, y: b.y - a.y }; })()`);
    // a line along the original's rows now slopes down by eight degrees on the screen
    expect((Math.atan2(turned.y, turned.x) * 180) / Math.PI).toBeCloseTo(8, 4);
    await page.tab.press("r");
    await page.tab.click(seen.x, seen.y);
    expect(await page.tab.run("window.app.editing().stage.picked()")).toBe(cover.id);
    await page.tab.press("Escape");
    // words read, laid where the reader found them in the original: pressed where they are now, the word is hidden
    await page.tab.run(`window.app.editing().stage.setWords(${JSON.stringify([{ text: "", sure: 1, box: { at: { x: 400, y: 500 }, along: { x: 1, y: 0 }, length: 300, height: 30 }, words: [{ text: "secret", sure: 1, line: 0, box: { at: { x: 410, y: 505 }, along: { x: 1, y: 0 }, length: 120, height: 20 } }] }])})`);
    await page.tab.press("w");
    await page.tab.run("window.app.editing().reading?.cancel?.()");
    const word = await page.onScreen(470, 515);
    await page.tab.run("window.app.editing().stage.setTool('read')");
    await page.tab.click(word.x, word.y);
    const hidden = (await stepsOf()).filter((step) => step.type === "cover");
    expect(hidden).toHaveLength(2);
    expect(hidden[1]!.rect).toEqual({ x: 407, y: 502, width: 126, height: 26 });
    await page.tab.run("window.app.editing().stage.setTool('none')");
    // a box made now is upright on the screen: kept turned back by the picture's eight degrees
    await page.tab.press("b");
    const corner = await page.onScreen(800, 150);
    await page.tab.drag(corner, { x: corner.x + 120, y: corner.y + 60 }, 6);
    const box = (await page.tab.run<{ type: string; angle?: number; rect: { width: number; height: number } }[]>("window.app.editing().steps()")).at(-1)!;
    expect(box.type).toBe("box");
    expect(box.angle).toBe(-8);
    const scale = await page.tab.run<number>("window.app.editing().stage.scale()");
    expect(box.rect.width * scale).toBeCloseTo(120, 0);
    // the export draws the cover and the arrow where they are on the turned picture
    const out = await page.tab.run<{ width: number; cover: number[]; arrow: number[] }>(`(async () => {
        const editing = window.app.editing();
        const pixels = await editing.flatten();
        const look = editing.stage.toScreen;
        const turn = 8 * Math.PI / 180;
        const level = (p) => ({ x: Math.cos(turn) * (p.x - 600) - Math.sin(turn) * (p.y - 350) + 600, y: Math.sin(turn) * (p.x - 600) + Math.cos(turn) * (p.y - 350) + 350 });
        const crop = editing.steps().find((step) => step.type === "crop");
        const frame = ${JSON.stringify(frame)};
        const at = (p) => { const q = level(p); const x = Math.round(q.x - frame.x), y = Math.round(q.y - frame.y); return [...pixels.data.slice((y * pixels.width + x) * 4, (y * pixels.width + x) * 4 + 3)]; };
        return { width: pixels.width, cover: at(${JSON.stringify(middle)}), arrow: at({ x: 850, y: 400 }), crop: !!crop };
    })()`);
    expect(out.width).toBe(frame.width);
    // the button's blue is under a cover of the color round it, the page's near white; the arrow is red
    expect(out.cover[2]! < 200 && out.cover[0]! < 100).toBe(false);
    expect(out.arrow[0]!).toBeGreaterThan(200);
    expect(out.arrow[1]!).toBeLessThan(120);
}, 60_000);

test("Ctrl+1 shows the picture at one to one and Ctrl+0 fits it again", async () => {
    if (!page) return;
    await page.tab.press("1", { ctrl: true });
    expect(await page.tab.run("window.app.editing().stage.scale()")).toBe(1);
    await page.tab.press("0", { ctrl: true });
    expect(await page.tab.run<number>("window.app.editing().stage.scale()")).toBeLessThanOrEqual(1);
});

test("a mark picked moves with the arrows and goes with Delete, undo brings it back, and Escape leaves the tool", async () => {
    if (!page) return;
    await page.paste("screenshot");
    await page.tab.press("a");
    await page.tab.drag(await page.onScreen(600, 400), await page.onScreen(300, 300), 6);
    const made = await stepsOf();
    expect(made.map((step) => step.type)).toEqual(["arrow"]);
    await page.tab.press("ArrowLeft", { shift: true });
    expect((await stepsOf())[0]!.from!.x).toBeCloseTo(made[0]!.from!.x - 10, 5);
    await page.tab.press("Delete");
    expect(await stepsOf()).toEqual([]);
    await page.tab.press("z", { ctrl: true });
    expect((await stepsOf()).map((step) => step.type)).toEqual(["arrow"]);
    await page.tab.press("Escape");
    await page.tab.press("Escape");
    expect(await page.tab.run("window.app.editing().stage.tool()")).toBe("none");
}, 30_000);
