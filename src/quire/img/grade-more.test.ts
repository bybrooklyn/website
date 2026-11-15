// What the deeper controls are held to: a curve's point moves between its neighbours and is taken
// away when dragged off the square, but its ends never are; a point is added in order, not on top of
// another, and not past the most; a wheel's puck stays in its circle and snaps to the middle; and in
// Chromium, More opens, a press on the curve adds a point that a drag moves and a drag off takes
// away, each one undo; a wheel's puck goes under the pointer and back with a double press; and a
// color pressed in the picture is added with its hue, to be shifted on its own.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { addPoint, movePoint, puckAt } from "./grade-more";

const S = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];

test("a curve's point moves between its neighbours, is taken away when dragged off, and its ends never are", () => {
    expect(movePoint(S, 1, { x: 0.3, y: 0.7 })).toEqual({ points: [{ x: 0, y: 0 }, { x: 0.3, y: 0.7 }, { x: 1, y: 1 }], removed: false });
    expect(movePoint(S, 1, { x: 1.5, y: 0.5 }).removed).toBe(true);
    expect(movePoint(S, 1, { x: 1.5, y: 0.5 }).points).toHaveLength(2);
    // a little past the edge is not off yet: held to the square
    expect(movePoint(S, 1, { x: 0.5, y: 1.05 }).points[1]).toEqual({ x: 0.5, y: 1 });
    // held between its neighbours
    expect(movePoint(S, 1, { x: 0.999, y: 0.5 }).points[1]!.x).toBe(0.99);
    // an end dragged off stays, at the edge
    expect(movePoint(S, 0, { x: -1, y: 0.4 })).toEqual({ points: [{ x: 0, y: 0.4 }, S[1]!, S[2]!], removed: false });
});

test("a point is added in its place along the curve, never on top of another or past the most", () => {
    expect(addPoint(S, { x: 0.25, y: 0.4 })).toEqual({ points: [S[0]!, { x: 0.25, y: 0.4 }, S[1]!, S[2]!], index: 1 });
    expect(addPoint(S, { x: 0.505, y: 0.2 })).toBeUndefined();
    const full = Array.from({ length: 16 }, (_, at) => ({ x: at / 15, y: at / 15 }));
    expect(addPoint(full, { x: 0.03, y: 0.5 })).toBeUndefined();
});

test("a wheel's puck stays in its circle and snaps to its middle", () => {
    expect(puckAt(0.5, 0.25)).toEqual({ x: 0.5, y: 0.25 });
    expect(puckAt(3, 4)).toEqual({ x: 0.6, y: 0.8 });
    expect(puckAt(0.02, -0.03)).toEqual({ x: 0, y: 0 });
});

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-grade-more");
    if (!page) console.warn("grade More browser test skipped: needs a Chromium");
});
afterAll(async () => {
    await page?.close();
});
const gradeOf = () => page!.tab.run<Record<string, any> | undefined>("window.app.editing().steps().find((step) => step.type === 'grade')?.grade");

test("More opens; a press on the curve adds a point a drag moves and a drag off takes away; a wheel's puck goes under the pointer; a color pressed is added", async () => {
    if (!page) return;
    await page.paste("photo");
    await page.tab.press("g");
    await page.until("document.querySelector('.quire-img-grade-panel.open')");
    await page.tab.run("document.querySelector('.quire-img-grade-more summary').click()");
    await page.tab.wait(500);
    await page.tab.run("document.querySelector('.quire-img-curve-square').scrollIntoView({ block: 'center' })");
    await page.tab.wait(300);
    const square = await page.boxOf(".quire-img-curve-square");
    const pad = 8;
    const size = square.width - pad * 2;
    const at = (x: number, y: number) => ({ x: square.x + pad + x * size, y: square.y + pad + (1 - y) * size });
    // pressed on the line at a quarter and dragged up: a point at (0.25, 0.4)
    await page.tab.drag(at(0.25, 0.25), at(0.25, 0.4), 6);
    const points = (await gradeOf())?.curves?.all;
    expect(points).toHaveLength(3);
    expect(points[1].x).toBeCloseTo(0.25, 2);
    expect(points[1].y).toBeCloseTo(0.4, 2);
    // dragged off the square, it is taken away, and the grade is gone with it
    await page.tab.drag(at(0.25, 0.4), { x: square.x + square.width + 60, y: at(0.25, 0.4).y }, 8);
    expect(await gradeOf()).toBeUndefined();
    await page.tab.press("z", { ctrl: true });
    expect((await gradeOf())?.curves?.all).toHaveLength(3);
    // the shadows' wheel: the puck under the pointer, toward red
    await page.tab.run("document.querySelector('.quire-img-wheels').scrollIntoView({ block: 'center' })");
    await page.tab.wait(300);
    const wheel = await page.boxOf('.quire-img-wheel[data-key="shadows"] canvas');
    const middle = { x: wheel.x + wheel.width / 2, y: wheel.y + wheel.height / 2 };
    const radius = wheel.width / 2 - 9;
    await page.tab.drag(middle, { x: middle.x + radius * 0.5, y: middle.y }, 6);
    const puck = (await gradeOf())?.wheels?.shadows;
    expect(puck.x).toBeCloseTo(0.5, 1);
    expect(puck.y).toBeCloseTo(0, 1);
    await page.tab.run("document.querySelector('.quire-img-wheel[data-key=\"shadows\"] canvas').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))");
    expect((await gradeOf())?.wheels?.shadows).toBeUndefined();
    // a color picked in the picture: one of the photograph's colored discs
    await page.tab.run("document.querySelector('.quire-img-pick-color').click()");
    expect(await page.tab.run("window.app.editing().stage.armed()")).toBe(true);
    const disc = await page.onScreen(7919 % 4000 + 2, 104729 % 3000 + 2);
    await page.tab.click(disc.x, disc.y);
    await page.until("(window.app.editing().steps().find((step) => step.type === 'grade')?.grade.colors ?? []).length === 1");
    await page.until("document.querySelectorAll('.quire-img-own-color').length === 1");
}, 60_000);
