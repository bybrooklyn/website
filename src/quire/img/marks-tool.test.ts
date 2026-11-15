// The marks that came after the arrow, the box and the text, as the editor offers them, in headless Chromium:
// numbered steps put down by presses, renumbered when one is taken away, one set by hand and put back in order
// from the right-click menu; a highlighter level as dragged, free with Shift, laid along words read, darkening
// what is under it and leaving the words dark; a magnifier whose lens shows the place it looks at, exactly there,
// and in the export sharply from the original's own pixels even when the picture is made smaller, on the screen
// too; spotlights that shade all but their shapes, an overlap left bright, the shade changed for all at once; a
// text with an outline; marks that stay where they were put through a turn and a straightening; and the bar's
// mark button and menu, and the keys.

import { afterAll, beforeAll, expect, test } from "bun:test";
import sharp from "sharp";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { numbersOf, type Kept } from "./steps";

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-marks");
    if (!page) console.warn("marks browser test skipped: needs a Chromium");
}, 60_000);
afterAll(async () => {
    await page?.close();
});

type Step = Kept & { rect?: { x: number; y: number; width: number; height: number }; from?: { x: number; y: number }; to?: { x: number; y: number }; thickness?: number; value?: number; dim?: number };
const stepsOf = () => page!.tab.run<Step[]>("window.app.editing().steps()");
const focus = () => page!.tab.run("document.querySelector('.quire-img-stage').focus()");
/** Presses a button of the strip by its tooltip or its words. */
const strip = (label: string) => page!.tab.run(`[...document.querySelectorAll('.quire-img-strip button')].find((each) => each.title === ${JSON.stringify(label)} || each.textContent.trim() === ${JSON.stringify(label)}).click()`);
/** The export's pixel at a place, red, green and blue. */
const exported = (points: { x: number; y: number }[]) => page!.tab.run<number[][]>(`(async () => { const flat = await window.app.editing().flatten(); return ${JSON.stringify(points)}.map(({ x, y }) => [...flat.data.slice((Math.round(y) * flat.width + Math.round(x)) * 4, (Math.round(y) * flat.width + Math.round(x)) * 4 + 3)]); })()`);
/** Leaves any tool, so that a press picks. */
const noTool = async () => {
    await focus();
    await page!.tab.run("window.app.editing().stage.setTool('none')");
};

/** Pastes a PNG made here, and waits for it to be shown with the keyboard on it. */
async function pastePng(png: Buffer) {
    const was = await page!.tab.run<string>("window.app.editing().current().id ?? ''");
    await page!.tab.run(`(async () => { const bytes = Uint8Array.from(atob(${JSON.stringify(png.toString("base64"))}), (c) => c.charCodeAt(0)); const data = new DataTransfer(); data.items.add(new File([bytes], "image.png", { type: "image/png" })); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })); })()`);
    await page!.until(`window.app.editing().current().id !== ${JSON.stringify(was)} && window.app.editing().stage?.loaded() && document.querySelector(".quire-img-frame.shown") && document.activeElement === document.querySelector(".quire-img-stage")`);
}

test("numbered steps: each press puts down the next number, one taken away renumbers the rest, one set by hand keeps its number until put back in order from the right-click menu, and undo takes each back", async () => {
    if (!page) return;
    await page.paste("screenshot");
    await focus();
    await page.tab.press("n");
    expect(await page.tab.run("window.app.editing().stage.tool()")).toBe("number");
    for (const [x, y] of [[700, 100], [800, 200], [900, 300]] as const) {
        const at = await page.onScreen(x, y);
        await page.tab.click(at.x, at.y);
    }
    let steps = await stepsOf();
    expect(steps.map((step) => step.type)).toEqual(["number", "number", "number"]);
    expect([...numbersOf(steps).values()]).toEqual([1, 2, 3]);
    // the export draws each where it was pressed, in its color, its figure inside
    const [first] = await exported([{ x: 700 + 15, y: 100 }]);
    expect(first![0]).toBeGreaterThan(200);
    expect(first![1]).toBeLessThan(100);
    // the first pressed again picks it (with the tool still in hand), and Delete takes it away: the rest are 1 and 2
    const one = await page.onScreen(700, 100);
    await page.tab.click(one.x, one.y);
    expect(await page.tab.run("window.app.editing().stage.picked()")).toBe(steps[0]!.id);
    await page.tab.press("Delete");
    steps = await stepsOf();
    expect([...numbersOf(steps).values()]).toEqual([1, 2]);
    // the last set to 7 in the strip's field, which shows its number when it is picked
    const last = await page.onScreen(900, 300);
    await page.tab.click(last.x, last.y);
    expect(await page.tab.run("document.querySelector('.quire-img-strip-number').value")).toBe("2");
    await page.tab.run("(() => { const field = document.querySelector('.quire-img-strip-number'); field.focus(); field.value = '7'; })()");
    await page.tab.press("Enter");
    expect([...numbersOf(await stepsOf()).values()]).toEqual([1, 7]);
    expect(await page.tab.run("document.activeElement.className")).toBe("quire-img-stage");
    // the right-click menu on it offers Number in order, which counts it in order again
    await page.tab.run(`document.querySelector(".quire-img-stage").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: ${last.x}, clientY: ${last.y} }))`);
    await page.until("document.querySelector('.quire-img-press-menu:popover-open')");
    const lines = await page.tab.run<string[]>("[...document.querySelectorAll('.quire-img-press-menu .quire-menu-label')].map((each) => each.textContent)");
    expect(lines.slice(0, 4)).toEqual(["Remove", "Bring forward", "Send back", "Number in order"]);
    await page.tab.run("[...document.querySelectorAll('.quire-img-press-menu .quire-menu-line')].find((line) => line.textContent.includes('Number in order')).click()");
    expect([...numbersOf(await stepsOf()).values()]).toEqual([1, 2]);
    // each change is one undo
    await focus();
    await page.tab.press("z", { ctrl: true });
    expect([...numbersOf(await stepsOf()).values()]).toEqual([1, 7]);
    await page.tab.press("z", { ctrl: true });
    await page.tab.press("z", { ctrl: true });
    expect((await stepsOf()).length).toBe(3);
}, 60_000);

test("a highlighter is level as dragged and free with Shift, lies along words read when it starts on one, and darkens what is under it, leaving the words dark", async () => {
    if (!page) return;
    await page.paste("screenshot");
    await focus();
    await page.tab.press("h");
    // dragged a little crooked, it is level
    await page.tab.drag(await page.onScreen(500, 420), await page.onScreen(800, 440), 8);
    let made = (await stepsOf()).at(-1)!;
    expect(made.type).toBe("highlight");
    expect(made.to!.y).toBeCloseTo(made.from!.y, 6);
    await page.tab.drag(await page.onScreen(500, 520), await page.onScreen(800, 600), 8, { shift: true });
    made = (await stepsOf()).at(-1)!;
    expect(made.to!.y - made.from!.y).toBeGreaterThan(60);
    // words read on the email line (60 to 330 across, 140 to 166 down, as the reader would find it): a drag from the first word to the last lies along the line
    await page.tab.run(`window.app.editing().stage.setWords(${JSON.stringify([{ text: "Email: someone@example.com", sure: 1, box: { at: { x: 58, y: 140 }, along: { x: 1, y: 0 }, length: 276, height: 30 }, words: [{ text: "Email:", sure: 1, line: 0, box: { at: { x: 60, y: 143 }, along: { x: 1, y: 0 }, length: 62, height: 22 } }, { text: "someone@example.com", sure: 1, line: 0, box: { at: { x: 130, y: 143 }, along: { x: 1, y: 0 }, length: 200, height: 24 } }] }])})`);
    await page.tab.drag(await page.onScreen(80, 150), await page.onScreen(300, 175), 8);
    made = (await stepsOf()).at(-1)!;
    expect(made.from!.y).toBeCloseTo(155, 6);
    expect(made.to!.y).toBeCloseTo(155, 6);
    expect(made.from!.x).toBeCloseTo(60 - 3, 6);
    expect(made.to!.x).toBeCloseTo(330 + 3, 6);
    expect(made.thickness).toBeCloseTo(33, 6);
    // yellow: the page under it darkened to yellow, a letter's dark kept dark
    await page.tab.run(`window.app.editing().changeStep(${JSON.stringify(made.id)}, { color: "#ffd60a" })`);
    const letter = await page.tab.run<{ x: number; y: number }>("(async () => { const flat = await window.app.editing().flatten(); for (let x = 62; x < 120; x++) for (let y = 145; y < 165; y++) { const at = (y * flat.width + x) * 4; if (flat.data[at + 2] < 60) return { x, y }; } return { x: -1, y: -1 }; })()");
    expect(letter.x).toBeGreaterThan(0);
    const [page0, ink] = await exported([{ x: 58, y: 150 }, letter]);
    expect(page0![0]).toBeGreaterThan(200);
    expect(page0![2]).toBeLessThan(140);
    expect(Math.max(...ink!)).toBeLessThan(90);
}, 60_000);

test("a magnifier's lens shows exactly the place it looks at, enlarged, and in the export sharply from the original's own pixels though the picture is made smaller; on the screen too; the lens and the place it looks at move on their own", async () => {
    if (!page) return;
    // a gray picture with a patch of one-pixel stripes and a red square
    const size = { width: 800, height: 600 };
    const raw = Buffer.alloc(size.width * size.height * 3, 128);
    for (let y = 0; y < size.height; y++)
        for (let x = 0; x < size.width; x++) {
            const at = (y * size.width + x) * 3;
            if (x >= 200 && x < 300 && y >= 200 && y < 300) raw.fill(x % 2 ? 255 : 0, at, at + 3);
            if (x >= 400 && x < 420 && y >= 400 && y < 420) raw.set([230, 20, 20], at);
        }
    await pastePng(await sharp(raw, { raw: { ...size, channels: 3 } }).png().toBuffer());
    // made half as large
    const resize = await page.middle(".quire-img-bar [aria-label='Resize']");
    await page.tab.click(resize.x, resize.y);
    await page.until("document.activeElement?.getAttribute('aria-label') === 'Width'");
    await page.tab.type("400");
    await page.tab.press("Enter");
    await focus();
    await page.tab.press("m");
    await page.tab.drag(await page.onScreen(250, 250), await page.onScreen(600, 300), 8);
    const lens = (await stepsOf()).at(-1)!;
    expect(lens.type).toBe("magnifier");
    // put exactly: looking at the stripes' middle, four times, its lens 100 pixels across the original at (600, 300)
    await page.tab.run(`window.app.editing().changeStep(${JSON.stringify(lens.id)}, { from: { x: 250, y: 250 }, at: { x: 600, y: 300 }, radius: 100, zoom: 4 })`);
    const row = await page.tab.run<{ inLens: number[]; outside: number[] }>("(async () => { const flat = await window.app.editing().flatten(); const at = (x, y) => flat.data[(y * flat.width + x) * 4]; const inLens = []; for (let x = 270; x < 330; x++) inLens.push(at(x, 150)); const outside = []; for (let x = 105; x < 145; x++) outside.push(at(x, 145)); return { inLens, outside }; })()");
    // the lens, at half size four times enlarged, draws each stripe two pixels wide at full contrast; the picture made smaller has lost them
    expect(Math.max(...row.inLens) - Math.min(...row.inLens)).toBeGreaterThan(180);
    let turns = 0;
    for (let at = 1; at < row.inLens.length; at++) if (row.inLens[at]! > 128 !== row.inLens[at - 1]! > 128) turns++;
    expect(turns).toBeGreaterThan(20);
    expect(Math.max(...row.outside) - Math.min(...row.outside)).toBeLessThan(60);
    // looking at the red square's middle: its middle is at the lens's middle, its edges 20 pixels out each way (ten of the original's, enlarged twice at this size)
    await page.tab.run(`window.app.editing().changeStep(${JSON.stringify(lens.id)}, { from: { x: 410, y: 410 } })`);
    const [middle, inside, beyond] = await exported([{ x: 300, y: 150 }, { x: 300 + 17, y: 150 - 17 }, { x: 300 + 24, y: 150 }]);
    expect(middle![0]).toBeGreaterThan(200);
    expect(middle![1]).toBeLessThan(60);
    expect(inside![0]).toBeGreaterThan(200);
    expect(inside![1]).toBeLessThan(60);
    expect(beyond![0]).toBeLessThan(160);
    // on the screen the lens shows the same, once the card has made its picture
    await page.until(`(() => { const stage = window.app.editing().stage; const point = stage.toScreen({ x: 600, y: 300 }); const over = document.querySelector(".quire-img-over"); const ratio = over.width / document.querySelector(".quire-img-stage").clientWidth; const pixel = over.getContext("2d").getImageData(Math.round(point.x * ratio), Math.round(point.y * ratio), 1, 1).data; return pixel[0] > 200 && pixel[1] < 60; })()`);
    // the lens dragged moves alone; the place it looks at dragged moves alone
    await noTool();
    const there = await page.onScreen(600, 300);
    await page.tab.drag(there, { x: there.x + 40, y: there.y }, 6);
    let moved = (await stepsOf()).at(-1)!;
    expect((moved as unknown as { at: { x: number } }).at.x).toBeGreaterThan(640);
    expect(moved.from).toEqual({ x: 410, y: 410 });
    const source = await page.onScreen(410, 410);
    await page.tab.drag(source, { x: source.x, y: source.y - 30 }, 6);
    moved = (await stepsOf()).at(-1)!;
    expect(moved.from!.y).toBeLessThan(380);
    expect((moved as unknown as { at: { x: number } }).at.x).toBeGreaterThan(640);
}, 90_000);

test("spotlights shade all but their shapes, an overlap left bright, and the shade is changed for every one at once", async () => {
    if (!page) return;
    await page.paste("screenshot");
    await focus();
    await page.tab.press("s");
    await page.tab.drag(await page.onScreen(500, 100), await page.onScreen(700, 300), 8);
    await strip("Ellipse");
    await page.tab.drag(await page.onScreen(650, 250), await page.onScreen(850, 450), 8);
    const steps = await stepsOf();
    expect(steps.map((step) => step.type)).toEqual(["spotlight", "spotlight"]);
    // the first was picked when Ellipse was pressed, so it became an ellipse too, as a color would change it
    expect(steps.every((step) => (step as unknown as { round?: boolean }).round)).toBe(true);
    const [inside, overlap, outside] = await exported([{ x: 600, y: 200 }, { x: 680, y: 280 }, { x: 1100, y: 650 }]);
    expect(inside![0]).toBeGreaterThan(235);
    expect(overlap![0]).toBeGreaterThan(235);
    expect(outside![0]).toBeGreaterThan(100);
    expect(outside![0]).toBeLessThan(120);
    // Dark shade, with the second picked, shades with both darker
    await strip("Dark shade");
    expect((await stepsOf()).map((step) => step.dim)).toEqual([0.75, 0.75]);
    const [darker] = await exported([{ x: 1100, y: 650 }]);
    expect(darker![0]).toBeLessThan(70);
    // the edge picks a spotlight, its middle leaves what is in it to be pressed
    await noTool();
    const middle = await page.onScreen(600, 200);
    await page.tab.click(middle.x, middle.y);
    expect(await page.tab.run("window.app.editing().stage.picked()")).toBeUndefined();
}, 60_000);

test("a text has an outline in the color chosen round its letters, and lines aligned", async () => {
    if (!page) return;
    await page.paste("screenshot");
    await focus();
    await page.tab.press("t");
    await strip("White");
    await strip("Align center");
    await page.tab.run("document.querySelector('.quire-img-strip button[title=Outline]').click()");
    await page.until("document.querySelector('.quire-img-outline-menu:popover-open')");
    await page.tab.run("[...document.querySelectorAll('.quire-img-outline-menu .quire-menu-line')].find((each) => each.textContent.includes('Black')).click()");
    await page.tab.press("Escape");
    expect(await page.tab.run("window.app.editing().stage.tool()")).toBe("text");
    const at = await page.onScreen(800, 450);
    await page.tab.click(at.x, at.y);
    await page.tab.type("WIDE");
    await page.tab.press("Enter", { shift: true });
    await page.tab.type("hi");
    await page.tab.press("Enter");
    const text = (await stepsOf()).at(-1)! as unknown as { text: string; outline: string; outlineWidth: number; align: string; at: { x: number } };
    expect(text).toMatchObject({ text: "WIDE\nhi", outline: "#000000", align: "center" });
    expect(text.outlineWidth).toBeGreaterThan(1);
    const counted = await page.tab.run<{ white: number; black: number; left: number; right: number }>(`(async () => { const flat = await window.app.editing().flatten(); let white = 0, black = 0, left = 9999, right = 0; for (let y = 440; y < 540; y++) for (let x = 600; x < 1000; x++) { const at = (y * flat.width + x) * 4; const [r, g, b] = flat.data.slice(at, at + 3); if (r > 250 && g > 250 && b > 250) white++; if (r < 40 && g < 40 && b < 40) { black++; left = Math.min(left, x); right = Math.max(right, x); } } return { white, black, left, right }; })()`);
    expect(counted.white).toBeGreaterThan(200);
    expect(counted.black).toBeGreaterThan(200);
    // centered: the ink lies about the place pressed
    expect(Math.abs((counted.left + counted.right) / 2 - text.at.x)).toBeLessThan(4);
}, 60_000);

test("turned by the dial, a number stays where it was put and is picked there; straightened, a text is drawn at its place, on the corner of a box made there", async () => {
    if (!page) return;
    await page.paste("screenshot");
    await focus();
    await page.tab.press("n");
    const at = await page.onScreen(900, 200);
    await page.tab.click(at.x, at.y);
    const number = (await stepsOf()).at(-1)!;
    await page.tab.press("c");
    await page.tab.run("document.querySelector('.quire-img-dial').focus()");
    for (let step = 0; step < 8; step++) await page.tab.press("ArrowRight", { shift: true });
    await focus();
    await page.tab.press("Escape");
    await page.tab.press("Escape");
    const there = await page.onScreen((number as unknown as { at: { x: number } }).at.x, (number as unknown as { at: { y: number } }).at.y);
    await page.tab.click(there.x, there.y);
    expect(await page.tab.run("window.app.editing().stage.picked()")).toBe(number.id);
    // straightened by the vertical dial, a box and a text put at the same place: the text's ink starts at the box's corner
    await page.paste("screenshot");
    await page.tab.press("p");
    await page.until("document.querySelector('.quire-img-strip[data-kind=perspective]')");
    await page.tab.run("document.querySelector('.quire-img-strip .quire-img-dial[aria-label=Vertical]').focus()");
    for (let step = 0; step < 8; step++) await page.tab.press("ArrowRight", { shift: true });
    await focus();
    await page.tab.press("Escape");
    await page.tab.press("Escape");
    await page.tab.press("b");
    await page.tab.drag(await page.onScreen(700, 300), await page.onScreen(900, 400), 6);
    const box = (await stepsOf()).at(-1)!;
    await page.tab.run(`window.app.editing().changeStep(${JSON.stringify(box.id)}, { color: "#30d158", rect: { x: 700, y: 300, width: 200, height: 100 }, angle: undefined })`);
    await page.tab.press("t");
    const writeAt = await page.onScreen(400, 400);
    await page.tab.click(writeAt.x, writeAt.y);
    await page.tab.type("H");
    await page.tab.press("Enter");
    const text = (await stepsOf()).at(-1)!;
    await page.tab.run(`window.app.editing().changeStep(${JSON.stringify(text.id)}, { color: "#ff3b30", at: { x: 700, y: 300 }, angle: undefined })`);
    const found = await page.tab.run<{ blue: number[]; red: number[] }>(`(async () => { const flat = await window.app.editing().flatten(); let blue = [9999, 9999], red = [9999, 9999]; for (let y = 0; y < flat.height; y++) for (let x = 500; x < flat.width; x++) { const at = (y * flat.width + x) * 4; const [r, g, b] = flat.data.slice(at, at + 3); if (g > 180 && r < 100 && b < 130 && x + y < blue[0] + blue[1]) blue = [x, y]; if (r > 200 && g < 110 && b < 110 && x + y < red[0] + red[1]) red = [x, y]; } return { blue, red }; })()`);
    expect(Math.abs(found.red[0]! - found.blue[0]!)).toBeLessThan(14);
    expect(Math.abs(found.red[1]! - found.blue[1]!)).toBeLessThan(14);
}, 90_000);

test("the bar keeps the mark last used one press away, beside a menu of all seven grown from its button, and each mark has its key", async () => {
    if (!page) return;
    await page.paste("screenshot");
    await focus();
    for (const [key, tool, label] of [["n", "number", "Numbered step (N)"], ["h", "highlight", "Highlighter (H)"], ["m", "magnifier", "Magnifier (M)"], ["s", "spotlight", "Spotlight (S)"], ["a", "arrow", "Arrow (A)"]] as const) {
        await page.tab.press(key);
        expect(await page.tab.run("window.app.editing().stage.tool()")).toBe(tool);
        expect(await page.tab.run("document.querySelector('.quire-img-bar .quire-button[aria-label$=\")\"]:not([aria-label^=Undo]):not([aria-label^=Redo]).pressed')?.getAttribute('aria-label')")).toBe(label);
        await page.tab.press("Escape");
    }
    const more = await page.middle(".quire-img-bar [aria-label='Marks']");
    await page.tab.click(more.x, more.y);
    await page.until("document.querySelector('.quire-img-marks-menu:popover-open')");
    const lines = await page.tab.run<string[]>("[...document.querySelectorAll('.quire-img-marks-menu .quire-menu-label')].map((each) => each.textContent)");
    expect(lines).toEqual(["Arrow", "Box", "Text", "Numbered step", "Highlighter", "Magnifier", "Spotlight"]);
    // the menu holds the keyboard: Escape closes it and leaves the tool as it was
    await page.tab.press("Escape");
    await page.until("!document.querySelector('.quire-img-marks-menu:popover-open')");
    await page.tab.click(more.x, more.y);
    await page.until("document.querySelector('.quire-img-marks-menu:popover-open')");
    await page.tab.run("[...document.querySelectorAll('.quire-img-marks-menu .quire-menu-line')].find((line) => line.textContent.includes('Spotlight')).click()");
    expect(await page.tab.run("window.app.editing().stage.tool()")).toBe("spotlight");
    expect(await page.tab.run("document.querySelector('.quire-img-bar [aria-label=\"Spotlight (S)\"]') !== null")).toBe(true);
}, 60_000);

test("a number put down before a spotlight is as bright in the export as one put down after it", async () => {
    if (!page) return;
    await page.paste("screenshot");
    await focus();
    await page.tab.press("n");
    const first = await page.onScreen(1000, 150);
    await page.tab.click(first.x, first.y);
    await page.tab.press("s");
    await page.tab.drag(await page.onScreen(500, 100), await page.onScreen(700, 300), 8);
    await page.tab.press("n");
    const second = await page.onScreen(1000, 400);
    await page.tab.click(second.x, second.y);
    const numbers = (await stepsOf()).filter((step) => step.type === "number") as unknown as { at: { x: number; y: number }; size: number }[];
    expect(numbers.length).toBe(2);
    // a point inside each circle, beside its figure; and one of the picture, far from both and from the spotlight
    const [before, after, shaded] = await exported([...numbers.map(({ at, size }) => ({ x: at.x - size * 0.36, y: at.y })), { x: 1100, y: 650 }]);
    expect(before).toEqual(after);
    expect(shaded![0]).toBeLessThan(120);
}, 60_000);
