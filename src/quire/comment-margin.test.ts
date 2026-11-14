// The writer's notes, used for real in headless Chromium: words are selected and a note added from
// Insert, Comment; it sits in the margin beside its words on a wide window, its words marked; it is
// resolved and the resolve undone; next goes to it; its words deleted, it says so; on a narrow
// window the notes are a list that opens from the menus. The Markdown never changes. Skipped, with
// a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { writtenWhen } from "./comment-margin";
import { editorPage, type EditorPage } from "../../scripts/quire-page";

let page: EditorPage | undefined;

beforeAll(async () => {
    page = await editorPage(1500, 900);
}, 60_000);

afterAll(async () => {
    await page?.close();
});

const skip = () => {
    if (page) return false;
    console.warn("comment-margin.test.ts: no Chromium on this machine, so the notes were not tried");
    return true;
};

const TEXT = "# Notes\n\nThe quick brown fox jumps over the lazy dog.\n\nA second line.\n";
const marked = () => page!.tab.run<number>("CSS.highlights.get('quire-note')?.size ?? 0");

test("a note's date is written as the site writes dates, with the time for one written today", () => {
    const now = new Date(2026, 10, 12, 18, 30).getTime();
    expect(writtenWhen(new Date(2026, 10, 12, 9, 5).getTime(), now)).toBe("Today, 09:05");
    expect(writtenWhen(new Date(2026, 2, 4).getTime(), now)).toBe("March 4, 2026");
});

test("words selected and a note added from Insert sit in the margin beside their words, marked, the Markdown unchanged", async () => {
    if (skip()) return;
    const { tab } = page!;
    await page!.reset(TEXT, [1], 4, [1], 15);
    await page!.menuLine("Insert", "Comment");
    await tab.wait(100);
    expect(await tab.run("document.activeElement.className")).toBe("quire-note-field");
    await tab.type("Too quick?");
    // the comment's buttons are in every dialog's order, named as Docs names them
    expect(await tab.run("[...document.querySelectorAll('.quire-note-form button')].map((each) => each.textContent)")).toEqual(["Cancel", "Comment"]);
    await page!.press(".quire-note-keep");
    await tab.wait(400);
    expect(await page!.md()).toBe(TEXT);
    expect(await tab.run("q.doc().comments.map((each) => [each.text, each.quote])")).toEqual([["Too quick?", "quick brown"]]);
    expect(await marked()).toBe(1);
    const card = await tab.run<{ x: number; y: number }>("q.box('.quire-notes .quire-note')");
    const words = await tab.run<{ x: number; y: number }>("(() => { const box = q.surface.rangeOf({ path: [1], offset: 4 }, { path: [1], offset: 15 }).getClientRects()[0]; return { x: box.left, y: box.top }; })()");
    // beside its words: to the right of the text, at the same height
    expect(card.x).toBeGreaterThan(words.x + 300);
    expect(Math.abs(card.y - words.y)).toBeLessThan(4);
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-details')).visibility")).toBe("hidden");
});

test("a note is resolved from its card, the resolve undone, and next goes to it", async () => {
    if (skip()) return;
    const { tab } = page!;
    await page!.press(".quire-notes .quire-note");
    await tab.wait(300);
    await page!.press(".quire-notes .quire-note button", "Resolve");
    await tab.wait(300);
    expect(await tab.run("q.doc().comments[0].resolved")).toBe(true);
    expect(await marked()).toBe(0);
    expect(await tab.run("document.querySelectorAll('.quire-notes .quire-note').length")).toBe(0);
    // with no open note the margin is the details' again, and the resolved one is in the list that View, Show comments opens as it shows them
    expect(await tab.run("getComputedStyle(document.querySelector('.quire-details')).visibility")).toBe("visible");
    await page!.menuLine("View", "Show comments");
    await tab.wait(300);
    expect(await tab.run("document.querySelectorAll('.quire-menu.open .quire-note').length")).toBe(0);
    await page!.menuLine("View", "Show comments");
    await tab.wait(300);
    expect(await tab.run("[...document.querySelectorAll('.quire-menu.open .quire-note.resolved button')].map((each) => each.textContent)")).toContain("Reopen");
    await tab.press("Escape");
    await tab.run("q.surface.undo()");
    await tab.wait(300);
    expect(await tab.run("q.doc().comments[0].resolved ?? false")).toBe(false);
    await page!.reset(TEXT.replace("A second", "Second"), [2], 0);
    expect(await tab.run("q.doc().comments")).toBeUndefined();
});

test("a note whose words are deleted says so in its card, and undo brings the words and the mark back", async () => {
    if (skip()) return;
    const { tab } = page!;
    await page!.reset(TEXT, [2], 2, [2], 8);
    await tab.run("q.editor.surface.focus()");
    await tab.press("m", { ctrl: true, alt: true });
    await tab.wait(100);
    await tab.type("Count again");
    await tab.press("Enter", { ctrl: true });
    await tab.wait(300);
    await tab.run("q.select([2], 0, [2], 14)");
    await tab.press("Backspace");
    await tab.wait(300);
    expect(await tab.run("document.querySelector('.quire-note.gone .quire-note-gone')?.textContent")).toContain("“second”, are gone from the text");
    await tab.run("q.surface.undo()");
    await tab.wait(300);
    expect(await tab.run("document.querySelectorAll('.quire-note.gone').length")).toBe(0);
    expect(await marked()).toBe(1);
    await page!.press(".quire-notes .quire-note");
    await tab.wait(300);
    await page!.press(".quire-notes .quire-note button", "Remove the comment");
    await tab.wait(200);
    expect(await tab.run("q.doc().comments")).toBeUndefined();
    expect(await page!.md()).toBe(TEXT);
});

test("on a narrow window the notes are a list that opens from View", async () => {
    if (skip()) return;
    const { tab } = page!;
    await tab.resize(390, 800);
    await tab.wait(300);
    await page!.reset(TEXT, [1], 4, [1], 9);
    await tab.press("m", { ctrl: true, alt: true });
    await tab.wait(400);
    expect(await tab.run("!!document.querySelector('.quire-menu.open .quire-notes-list .quire-note-field')")).toBe(true);
    await tab.type("Narrow");
    await tab.press("Enter", { ctrl: true });
    await tab.wait(300);
    expect(await tab.run("[...document.querySelectorAll('.quire-menu.open .quire-notes-list .quire-note-text')].map((each) => each.textContent)")).toEqual(["Narrow"]);
    expect(await tab.run("document.querySelector('.quire-notes-where')?.textContent")).toBe("A Markdown file cannot hold comments, so these are kept in this browser only.");
    await tab.resize(1500, 900);
    await tab.wait(300);
});
