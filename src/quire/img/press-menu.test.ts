// Which lines the picture's right-click menu holds: what is picked first, then copy and paste, then export;
// and, in headless Chromium, the menu opened by a right-click on the empty room, on the picture and on a
// mark, and Paste in it taking the picture on the clipboard.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";
import { RULE, type MenuItem } from "../core/ui";
import { pressLines } from "./press-menu";

const line = (label: string, key: string, disabled = false): MenuItem => ({ label, key, disabled, run: () => {} });
const menus = (words: boolean, picked: boolean) => [
    { items: () => [line("Export", "export")] },
    {
        items: () => [
            line("Undo", "undo"),
            line("Copy", "copy"),
            { label: "Copy as", items: () => [line("As it looks", "looks")], run: () => {} } as MenuItem,
            line("Copy text", "copy-text", !words),
            line("Paste", "paste"),
            line("Remove", "remove", !picked),
            line("Bring forward", "forward", !picked),
            line("Send back", "back", !picked),
        ],
    },
];
const choose = line("Choose a picture", "choose");
const said = (lines: MenuItem[]) => lines.map((each) => (each === RULE ? "-" : each.label));

test("with no picture the menu is Paste and Choose a picture", () => {
    expect(said(pressLines(menus(false, false), { picture: false, picked: false }, choose))).toEqual(["Paste", "Choose a picture"]);
});

test("on the picture it is Copy and Paste, then Export under a rule; Copy text is there only when words were read", () => {
    expect(said(pressLines(menus(false, false), { picture: true, picked: false }, choose))).toEqual(["Copy", "Paste", "-", "Export"]);
    expect(said(pressLines(menus(true, false), { picture: true, picked: false }, choose))).toEqual(["Copy", "Copy text", "Paste", "-", "Export"]);
});

test("on a mark or a cover its own lines come first, with a rule under them", () => {
    expect(said(pressLines(menus(false, true), { picture: true, picked: true }, choose))).toEqual(["Remove", "Bring forward", "Send back", "-", "Copy", "Paste", "-", "Export"]);
});

test("each line is the menus' own, so it does what that line does", () => {
    const table = menus(false, true);
    const edit = table[1]!.items();
    const lines = pressLines([{ items: () => table[0]!.items() }, { items: () => edit }], { picture: true, picked: true }, choose);
    expect(lines.find((each) => each.label === "Paste")).toBe(edit.find((each) => each.label === "Paste")!);
});

let page: ImgPage | undefined;
beforeAll(async () => {
    page = await imgPage("img-press-menu");
    if (!page) console.warn("press menu browser test skipped: needs a Chromium");
}, 60_000);
afterAll(async () => {
    await page?.close();
});
/** A right-click at a place on the screen, on whatever is there; says whether the page kept the browser's own menu away. */
const rightClick = (x: number, y: number, shift = false) => page!.tab.run<boolean>(`(() => { const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, shiftKey: ${shift}, clientX: ${x}, clientY: ${y} }); document.elementFromPoint(${x}, ${y}).dispatchEvent(event); return event.defaultPrevented; })()`);
const lines = () => page!.tab.run<string[]>("[...document.querySelectorAll('.quire-img-press-menu:popover-open .quire-menu-label')].map((each) => each.textContent)");
const shut = async () => {
    await page!.tab.press("Escape");
    await page!.until("!document.querySelector('.quire-img-press-menu:popover-open')");
};

test("a right-click on the empty room offers Paste and Choose a picture, and Paste takes the picture on the clipboard", async () => {
    if (!page) return;
    // a new picture from the shelf, with nothing in it yet
    await page.tab.run("[...document.querySelectorAll('.quire-host a, .quire-host button')].find((each) => each.textContent.trim() === 'picture').click()");
    await page.until("document.querySelector('.quire-img-room.blank') && !document.querySelector('.quire-host.shelved')");
    const room = await page.boxOf(".quire-img-room");
    expect(await rightClick(room.x + room.width / 2, room.y + room.height / 3)).toBe(true);
    await page.until("document.querySelector('.quire-img-press-menu:popover-open')");
    expect(await lines()).toEqual(["Paste", "Choose a picture"]);
    // the clipboard holds a picture: Paste from the menu opens it
    await page.tab.run(`(async () => { const canvas = new OffscreenCanvas(300, 200); const context = canvas.getContext("2d"); context.fillStyle = "#246"; context.fillRect(0, 0, 300, 200); const blob = await canvas.convertToBlob({ type: "image/png" }); navigator.clipboard.read = async () => [{ types: ["image/png"], getType: async () => blob }]; })()`);
    await page.tab.run("[...document.querySelectorAll('.quire-img-press-menu:popover-open button')].find((each) => each.textContent.includes('Paste')).click()");
    await page.until("window.app.editing().stage?.loaded() && document.querySelector('.quire-img-frame.shown')");
    expect(await page.tab.run("(async () => { const flat = await window.app.editing().flatten(); return [flat.width, flat.height]; })()")).toEqual([300, 200]);
}, 60_000);

test("on the picture it offers Copy, Paste and Export; on a mark that mark is picked and its lines come first; Shift leaves the browser's menu", async () => {
    if (!page) return;
    const at = await page.onScreen(150, 100);
    expect(await rightClick(at.x, at.y)).toBe(true);
    await page.until("document.querySelector('.quire-img-press-menu:popover-open')");
    expect(await lines()).toEqual(["Copy", "Paste", "Export"]);
    // Escape closes the menu and gives the keyboard back to the picture
    await shut();
    expect(await page.tab.run("document.activeElement === document.querySelector('.quire-img-stage')")).toBe(true);
    // a box drawn, then nothing picked, then a right-click on its edge
    await page.tab.press("b");
    await page.tab.drag(await page.onScreen(60, 40), await page.onScreen(200, 150), 6);
    await page.tab.press("Escape");
    await page.tab.run("window.app.editing().stage.pick(undefined)");
    const edge = await page.onScreen(60, 90);
    expect(await rightClick(edge.x, edge.y)).toBe(true);
    await page.until("document.querySelector('.quire-img-press-menu:popover-open')");
    expect(await lines()).toEqual(["Remove", "Bring forward", "Send back", "Copy", "Paste", "Export"]);
    const boxStep = await page.tab.run<string>("window.app.editing().steps().find((step) => step.type === 'box').id");
    expect(await page.tab.run("window.app.editing().stage.picked()")).toBe(boxStep);
    // Remove from the menu takes the box away
    await page.tab.run("[...document.querySelectorAll('.quire-img-press-menu:popover-open button')].find((each) => each.textContent.includes('Remove')).click()");
    await page.until("!window.app.editing().steps().some((step) => step.type === 'box')");
    expect(await rightClick(at.x, at.y, true)).toBe(false);
}, 60_000);
