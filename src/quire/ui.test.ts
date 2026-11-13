// What the controls' counting is held to: the arrow keys walk a toolbar round and round, and a
// floating bar goes above what it is about when there is room, below when not, and never past the
// window's edges; a menu's shortcuts are drawn as the keys' symbols. Then the menu itself, in
// headless Chromium (skipped, with a notice, without one): it drops below its control and covers
// nothing, goes to the left or above where there is no room, is cut to the room, stays tied to the
// control as the page scrolls, grows from the control's edge and goes back to it, and closes on a
// press outside, on Escape and when another opens. Run with `bun test src/quire`.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium, type Browser } from "../../scripts/browser";
import { keySymbols, MOTION, moveIndex, originAt, placeNear, springCurve, typeAhead } from "./ui";

test("a letter typed in a menu goes to the next line starting with it, round again, and more letters spell more of it", () => {
    const labels = ["Undo", "Redo", "Select all", "Show the Markdown", "Search"];
    expect(typeAhead(labels, -1, "s")).toBe(2);
    expect(typeAhead(labels, 2, "s")).toBe(3);
    expect(typeAhead(labels, 4, "s")).toBe(2);
    expect(typeAhead(labels, 2, "sh")).toBe(3);
    expect(typeAhead(labels, 0, "x")).toBeUndefined();
    expect(typeAhead(labels, 0, "")).toBeUndefined();
});

test("the arrow keys move along a toolbar and wrap at the ends, Home and End go to the ends", () => {
    expect(moveIndex(0, "ArrowRight", 4)).toBe(1);
    expect(moveIndex(3, "ArrowRight", 4)).toBe(0);
    expect(moveIndex(0, "ArrowLeft", 4)).toBe(3);
    expect(moveIndex(2, "Home", 4)).toBe(0);
    expect(moveIndex(1, "End", 4)).toBe(3);
    expect(moveIndex(1, "ArrowDown", 4)).toBeUndefined();
    expect(moveIndex(1, "ArrowDown", 4, true)).toBe(2);
    expect(moveIndex(-1, "ArrowDown", 4, true)).toBe(0);
    expect(moveIndex(0, "ArrowRight", 0)).toBeUndefined();
});

test("a floating bar sits above its target, centred, when there is room", () => {
    const place = placeNear({ left: 400, top: 300, width: 200, height: 20 }, { width: 100, height: 40 }, { width: 1000, height: 800 });
    expect(place).toEqual({ left: 450, top: 252, side: "above" });
});

test("with no room above it goes below, and it never covers the target", () => {
    const target = { left: 400, top: 20, width: 200, height: 20 };
    const place = placeNear(target, { width: 100, height: 40 }, { width: 1000, height: 800 });
    expect(place.side).toBe("below");
    expect(place.top).toBeGreaterThanOrEqual(target.top + target.height);
});

test("it is slid along to stay inside the window at both edges", () => {
    expect(placeNear({ left: 0, top: 300, width: 10, height: 20 }, { width: 300, height: 40 }, { width: 390, height: 800 }).left).toBe(8);
    expect(placeNear({ left: 380, top: 300, width: 10, height: 20 }, { width: 300, height: 40 }, { width: 390, height: 800 }).left).toBe(82);
});

test("a shortcut is drawn as its keys' symbols and said in words; a hint that is not a shortcut stays as it is", () => {
    expect(keySymbols("Ctrl+B")).toEqual({ shown: "⌃B", words: "Control B" });
    expect(keySymbols("Ctrl+Shift+Z")).toEqual({ shown: "⌃⇧Z", words: "Control Shift Z" });
    expect(keySymbols("Ctrl+Alt+2")).toEqual({ shown: "⌃⌥2", words: "Control Alt 2" });
    expect(keySymbols("Ctrl+Enter")).toEqual({ shown: "⌃↵", words: "Control Enter" });
    expect(keySymbols("Ctrl+B", true)).toEqual({ shown: "⌘B", words: "Command B" });
    for (const hint of ["›", ".md", "bring back", "Ctrl+"]) expect(keySymbols(hint)).toEqual({ shown: hint, words: "" });
});

test("something opening grows from the point just pressed, and from its own corner when opened from the keyboard", () => {
    const box = { left: 100, top: 50, width: 300, height: 40 };
    expect(originAt(box, { x: 380, y: 30, at: 1000 }, 1200, "100% 0")).toBe("280px -20px");
    // a press long ago is not what opened it
    expect(originAt(box, { x: 380, y: 30, at: 1000 }, 1600, "100% 0")).toBe("100% 0");
    expect(originAt(box, undefined, 0, "100% 0")).toBe("100% 0");
});

test("the menus open in 200 ms on a slight spring and close in 140 ms, their lines 14 ms apart, as the lab chose", () => {
    expect(MOTION).toEqual({ open: 200, close: 140, stagger: 14, bounce: 0.14 });
    const points = springCurve(MOTION.bounce).slice(7, -1).split(", ").map(Number);
    expect(points[0]).toBe(0);
    expect(points.at(-1)).toBe(1);
    // a slight spring goes a little past its end and comes back
    expect(Math.max(...points)).toBeGreaterThan(1);
    expect(Math.max(...points)).toBeLessThan(1.1);
});

// ---- the menu in a browser: a popover tied to its control by anchor positioning ----

const live = !!chromium();
let folder = "";
let tab: Browser;
const page = `
import { flowMenu, linkForm } from "${import.meta.dir}/ui.ts";
window.linkForm = linkForm;
const lines = (count) => Array.from({ length: count }, (_, at) => ({ label: "Line " + (at + 1), run: () => {} }));
window.menu = flowMenu("A menu");
window.other = flowMenu("Another");
window.opened = (id, count = 5) => window.menu.open(document.getElementById(id), lines(count));
for (const button of document.querySelectorAll("button.opener")) button.addEventListener("click", () => (window.menu.isOpen() && document.querySelector(".quire-menu.open") && button.classList.contains("open") ? window.menu.close(true) : window.opened(button.id)));
`;

beforeAll(async () => {
    if (!live) return console.warn("menu browser test skipped: needs a Chromium");
    folder = await mkdtemp(join(tmpdir(), "quire-menu-"));
    await Bun.write(`${folder}/page.ts`, page);
    const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const styles = `${import.meta.dir}/../styles`;
    const theme = ":root{--ground:oklch(0.16 0.035 300);--surface:oklch(0.21 0.045 300);--rule:oklch(0.32 0.055 300);--ink:oklch(0.93 0.02 300);--muted:oklch(0.73 0.045 300);--accent:oklch(0.77 0.16 300)} body{height:3000px}";
    const css = (await Promise.all(["tokens.css", "base.css", "quire.css"].map((name) => Bun.file(`${styles}/${name}`).text()))).join("\n");
    const at = (id: string, where: string) => `<button class="opener quire-button" id="${id}" style="position:absolute;${where};width:60px;height:30px">${id}</button>`;
    await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><style>${css}${theme}</style><body class="quire-app">${at("top", "left:100px;top:40px")}${at("corner", "right:20px;top:40px")}${at("low", "left:100px;top:700px")}<button id="away" style="position:absolute;left:600px;top:400px">away</button><script type="module">${await built.outputs[0]!.text()}</script></body>`);
    tab = await browser({ width: 1000, height: 800 });
    await tab.open(`file://${folder}/page.html`, 200);
    if (tab.errors.length) throw new Error(tab.errors.join("\n"));
}, 60_000);

afterAll(async () => {
    if (!live) return;
    await tab?.close();
    await rm(folder, { recursive: true, force: true });
});

const run = <T>(expression: string) => tab.run<T>(expression);
const settle = () => run("document.getAnimations().forEach((each) => each.finish())");
const boxes = (id: string) => run<{ menu: { left: number; top: number; right: number; bottom: number; height: number }; control: { left: number; top: number; right: number; bottom: number } }>(`(() => { const box = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height }; }; return { menu: box(window.menu.box), control: box(document.getElementById(${JSON.stringify(id)})) }; })()`);
const used = (name: string, run: () => Promise<void>) => test.skipIf(!live)(name, run, 30_000);

used("a menu is a popover over everything that drops below its control, its left edge on the control's, and covers nothing", async () => {
    await run("window.opened('top')");
    await settle();
    expect(await run<boolean>("window.menu.box.matches(':popover-open')")).toBe(true);
    const { menu, control } = await boxes("top");
    expect(menu.left).toBeCloseTo(control.left, 0);
    expect(menu.top).toBeGreaterThanOrEqual(control.bottom);
    expect(menu.top - control.bottom).toBeLessThan(6);
    await run("window.menu.close()");
});

used("its first frame is the control's bottom edge, as wide as the control", async () => {
    await run("window.opened('top')");
    const first = await run<{ width: number; height: number }>("(() => { document.getAnimations().forEach((each) => { each.pause(); each.currentTime = 0; }); const r = window.menu.box.getBoundingClientRect(); return { width: r.width, height: r.height }; })()");
    expect(first.width).toBeCloseTo(60, 0);
    expect(first.height).toBeCloseTo(0, 0);
    await settle();
    await run("window.menu.close()");
    await settle();
});

used("with no room to the right it keeps to the control's right edge, and with no room below it goes above", async () => {
    await run("window.opened('corner')");
    await settle();
    let { menu, control } = await boxes("corner");
    expect(menu.right).toBeCloseTo(control.right, 0);
    await run("window.opened('low', 12)");
    await settle();
    ({ menu, control } = await boxes("low"));
    expect(menu.bottom).toBeLessThanOrEqual(control.top);
    await run("window.menu.close()");
    await settle();
});

used("a menu taller than its room is cut to the room and scrolls inside itself", async () => {
    await run("window.opened('top', 60)");
    await settle();
    const { menu } = await boxes("top");
    expect(menu.bottom).toBeLessThanOrEqual(800);
    expect(await run<boolean>("(() => { const items = window.menu.box.querySelector('.quire-menu-items'); return items.scrollHeight > items.clientHeight; })()")).toBe(true);
    await run("window.menu.close()");
    await settle();
});

used("it stays tied to its control as the page scrolls", async () => {
    await run("window.opened('top')");
    await settle();
    await run("scrollTo(0, 120)");
    await tab.wait(100);
    const { menu, control } = await boxes("top");
    expect(menu.top - control.bottom).toBeLessThan(6);
    expect(menu.top - control.bottom).toBeGreaterThanOrEqual(0);
    await run("scrollTo(0, 0)");
    await run("window.menu.close()");
    await settle();
});

used("a press outside closes it, Escape closes it and gives focus back, and a press on its own control closes it rather than opening it again", async () => {
    await run("window.opened('top')");
    await settle();
    await tab.click(500, 600);
    await tab.wait(50);
    expect(await run<boolean>("window.menu.isOpen()")).toBe(false);
    await settle();
    await run("document.getElementById('top').focus(); window.menu.open(document.getElementById('top'), [{ label: 'One', run() {} }, { label: 'Two', run() {} }], true)");
    await tab.press("Escape");
    expect(await run<boolean>("window.menu.isOpen()")).toBe(false);
    expect(await run<string>("document.activeElement.id")).toBe("top");
    await settle();
    // the control, pressed with the menu open, closes it
    await tab.click(130, 55);
    await settle();
    expect(await run<boolean>("window.menu.isOpen()")).toBe(true);
    await tab.click(130, 55);
    await tab.wait(50);
    expect(await run<boolean>("window.menu.isOpen()")).toBe(false);
    await settle();
});

used("a menu opened from the keyboard while writing (a shortcut) gives the focus back to the writing when it closes, not to its control", async () => {
    await run("(() => { const writing = document.createElement('textarea'); writing.id = 'writing'; writing.style.cssText = 'position:absolute;left:300px;top:300px'; document.body.append(writing); writing.focus(); })()");
    await run("window.menu.open(document.getElementById('top'), [{ label: 'One', run() {} }, { label: 'Two', run() {} }], true)");
    expect(await run<string>("document.activeElement.textContent")).toBe("One");
    await tab.press("Escape");
    expect(await run<string>("document.activeElement.id")).toBe("writing");
    await settle();
    await run("document.getElementById('writing').remove()");
});

used("the Enter that picks an input method's word in a field is the input method's: the link field sets its address only on the Enter after", async () => {
    const set = await run<string[]>(`(() => {
        const said = [];
        const form = window.linkForm(undefined, { set: (href) => said.push(href), remove() {}, cancel: () => said.push("cancelled") });
        document.body.append(form);
        const field = form.querySelector("input");
        field.value = "https://example.com/日本";
        // Chrome and Firefox mark the key as composing; Safari ends the composition first and sends key code 229
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }));
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true, cancelable: true }));
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        form.remove();
        return said;
    })()`);
    expect(set).toEqual(["https://example.com/日本"]);
});

used("a line that is on or off says so to a screen reader, one of a group as a radio, and moves with the choice", async () => {
    await run("window.menu.open(document.getElementById('top'), [{ label: 'Plain', run() {} }, { label: 'Outline', pressed: true, run() {} }, { label: 'No page', pressed: true, group: 'look', run() {} }, { label: 'Paper', pressed: false, group: 'look', run() {} }])");
    await settle();
    const said = () => run<string[]>("[...window.menu.box.querySelectorAll('.quire-menu-line')].map((line) => line.getAttribute('role') + ' ' + line.getAttribute('aria-checked'))");
    expect(await said()).toEqual(["menuitem null", "menuitemcheckbox true", "menuitemradio true", "menuitemradio false"]);
    await run("window.menu.box.querySelectorAll('.quire-menu-line')[3].click()");
    expect(await said()).toEqual(["menuitem null", "menuitemcheckbox true", "menuitemradio false", "menuitemradio true"]);
    await run("window.menu.close()");
    await settle();
});

used("the element that is the menu carries the menu's name", async () => {
    await run("window.opened('top')");
    await settle();
    expect(await run<string | null>("window.menu.box.querySelector('[role=menu]').getAttribute('aria-label')")).toBe("A menu");
    await run("window.menu.close()");
    await settle();
});

used("closing, it is seen going back onto its control's edge, and opening another menu closes it", async () => {
    await run("window.opened('top')");
    await settle();
    await run("window.menu.close()");
    const last = await run<{ width: number; height: number; top: number }>("(() => { const copy = document.querySelector('.quire-menu.closing'); copy.getAnimations().forEach((each) => { each.pause(); each.currentTime = each.effect.getComputedTiming().endTime; }); const r = copy.getBoundingClientRect(); return { width: r.width, height: r.height, top: r.top }; })()");
    expect(last.width).toBeCloseTo(60, 0);
    expect(last.height).toBeCloseTo(0, 0);
    await settle();
    await tab.wait(50);
    expect(await run<number>("document.querySelectorAll('.quire-menu.closing').length")).toBe(0);
    await run("window.opened('top')");
    await run("window.other.open(document.getElementById('away'), [{ label: 'Else', run() {} }])");
    expect(await run<boolean>("window.menu.isOpen()")).toBe(false);
    expect(await run<number>("document.querySelectorAll('.quire-menu:popover-open').length")).toBe(1);
    await run("window.other.close()");
    await settle();
});

used("under reduced motion it is simply open or shut", async () => {
    await tab.media({ "prefers-reduced-motion": "reduce" });
    await run("window.opened('top')");
    expect(await run<number>("window.menu.box.getAnimations({ subtree: true }).length")).toBe(0);
    await run("window.menu.close()");
    expect(await run<number>("document.querySelectorAll('.quire-menu.closing').length")).toBe(0);
    await tab.media({});
});
