// The frame's name and status, used in headless Chromium: the name says the document's name and opens
// the list when pressed, and the status keeps how saving stands while a message passes over it,
// with the kind's count beside it. Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { corePage, quire, type CorePage } from "../../../scripts/core-page";
import { chromium } from "../../../scripts/browser";
import { STATUS_PASSES } from "./status";

const live = !!chromium();
let page: CorePage | undefined;

beforeAll(async () => {
    if (!live) return console.warn("status browser test skipped: needs a Chromium");
    page = await corePage(`
        import { nameButton, statusLine } from "${quire}/core/status.ts";
        const host = document.querySelector("#host");
        window.pressed = 0;
        window.named = nameButton("Untitled", () => window.pressed++);
        window.line = statusLine();
        host.append(window.named, window.line.element);
    `);
}, 60_000);

afterAll(async () => {
    await page?.close();
});

const run = <T>(expression: string) => page!.tab.run<T>(expression);

test.skipIf(!live)("the name says the document's name, for a screen reader too, and pressing it opens the list", async () => {
    await run("window.named.set('Letter to Sam')");
    expect(await run("[window.named.textContent, window.named.getAttribute('aria-label')]")).toEqual(["Letter to Sam", "Letter to Sam: documents"]);
    await run("window.named.click()");
    expect(await run("window.pressed")).toBe(1);
});

test.skipIf(!live)("how saving stands stays, a message passes over it and gives it back, and the count sits beside it", async () => {
    await run("window.line.say('Saved', 'Saved', 'quiet', true); window.line.count('7 words')");
    await page!.tab.wait(500);
    const said = () => run<string>("[...document.querySelectorAll('.quire-status-words.here')].map((each) => each.textContent).join()");
    expect(await said()).toBe("Saved");
    expect(await run("document.querySelector('.quire-count').textContent")).toBe("7 words");
    await run("window.line.say('Not opened', 'It was not opened', 'warn')");
    await page!.tab.wait(500);
    expect(await said()).toBe("Not opened");
    expect(await run("document.querySelector('.quire-status').classList.contains('warn')")).toBe(true);
    await page!.tab.wait(STATUS_PASSES);
    expect(await said()).toBe("Saved");
    // with nothing said about saving, the dot between goes too
    await run("window.line.say('', 'Nothing is open', 'quiet', true)");
    expect(await run("window.line.element.classList.contains('unsaid')")).toBe(true);
}, 20_000);

test.skipIf(!live)("two words are never seen in one place, even when one follows another within a frame or two, as Saved follows Saving", async () => {
    await run("window.line.say('Not saved', 'Not saved', 'quiet', true)");
    await page!.tab.wait(600);
    // looked at once, part way through the old words' fading and not before: asking for a style makes the browser work
    // one out, which is itself what the new words were missing, so a look every frame hides the fault it is looking for
    const seen = await run<string[]>(`new Promise((done) => {
        window.line.say('Saving', 'Saving', 'quiet', true);
        setTimeout(() => window.line.say('Saved', 'Saved', 'quiet', true), 10);
        setTimeout(() => done([...document.querySelectorAll('.quire-status-words')].filter((each) => +getComputedStyle(each).opacity > 0.02).map((each) => each.textContent)), 80);
    })`);
    expect(seen).toEqual(["Not saved"]);
    await page!.tab.wait(500);
    expect(await run("[...document.querySelectorAll('.quire-status-words')].filter((each) => +getComputedStyle(each).opacity > 0.98).map((each) => each.textContent).join()")).toBe("Saved");
}, 20_000);
