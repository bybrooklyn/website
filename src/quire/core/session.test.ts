// The session that holds one document of any kind, used in headless Chromium with a plain text field
// for a body and a store kept in memory: an edit is saved once typing pauses, a document changed
// elsewhere is not written over and the writer is told, a rename moves it, and moving to another
// document or to none saves first and puts the new one in. The words the status uses are pure.
// Skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { corePage, quire, type CorePage } from "../../../scripts/core-page";
import { chromium } from "../../../scripts/browser";
import { short } from "./session";

test("how saving stands is said in a word or two, and a file kept only in this tab asks to be downloaded", () => {
    expect([short({ state: "saved" }), short({ state: "saving" }), short({ state: "waiting" }), short({ state: "changed" }), short({ state: "failed", message: "no" })]).toEqual(["Saved", "Saving", "Not saved", "Changed", "Not saved"]);
    expect(short({ state: "saved" }, "Download it to keep it.")).toBe("Download");
});

const live = !!chromium();
let page: CorePage | undefined;

beforeAll(async () => {
    if (!live) return console.warn("session browser test skipped: needs a Chromium");
    page = await corePage(`
        import { createSession } from "${quire}/core/session.ts";
        import { memoryStore } from "${quire}/core/store.ts";
        const store = memoryStore("Memory");
        const first = await store.create("First", "One.\\n");
        const second = await store.create("Second", "Two.\\n");
        const text = document.createElement("textarea");
        document.querySelector("#host").append(text);
        const told = { said: [], named: [], placed: [] };
        const body = {
            writing: () => ({ text: text.value }),
            load: (found) => void (text.value = found.text),
            replace: (found) => void (text.value = found.text),
            empty: () => void (text.value = ""),
            placed: (where) => told.placed.push(where.name),
            named: (name) => told.named.push(name),
            download: () => {},
            from: () => text,
            focus: () => text.focus(),
        };
        text.value = "One.\\n";
        const session = createSession(body, { name: "First", store, id: first.id, mark: first.mark, say: (short) => told.said.push(short) });
        text.addEventListener("input", () => session.changed());
        window.q = { store, session, text, told, first, second };
    `);
}, 60_000);

afterAll(async () => {
    await page?.close();
});

const run = <T>(expression: string) => page!.tab.run<T>(expression);
const used = (name: string, body: () => Promise<void>) => test.skipIf(!live)(name, body, 30_000);

used("an edit is saved once typing pauses, and the status says so", async () => {
    await run("q.text.focus()");
    await page!.tab.type("More. ");
    expect(await run("q.told.said.at(-1)")).toBe("Not saved");
    await page!.tab.wait(1300);
    expect(await run("q.text.value")).toContain("More. ");
    expect(await run("q.store.files.get(q.first.id).text")).toBe(await run<string>("q.text.value"));
    expect(await run("q.told.said.at(-1)")).toBe("Saved");
});

used("a document changed elsewhere is not written over: the status says it changed, and their words stay theirs", async () => {
    await run("(() => { const file = q.store.files.get(q.first.id); file.text = 'Theirs.\\n'; file.mark++; })()");
    await run("q.text.focus()");
    await page!.tab.type("Mine. ");
    await page!.tab.wait(1300);
    expect(await run("q.store.files.get(q.first.id).text")).toBe("Theirs.\n");
    expect(await run("q.told.said.at(-1)")).toBe("Changed");
    // the writer takes theirs, and it is put in place of what she typed
    await run("[...q.session.conflict.element.querySelectorAll('button')].find((each) => each.textContent === 'Take theirs').click()");
    await page!.tab.wait(300);
    expect(await run("q.text.value")).toBe("Theirs.\n");
    expect(await run("q.told.said.at(-1)")).toBe("Saved");
});

used("a rename moves the document and tells the kind its new name", async () => {
    await run("q.session.open(q.store, { id: q.second.id, name: 'Second' })");
    expect(await run("q.text.value")).toBe("Two.\n");
    await run("q.session.rename('Second, renamed')");
    expect(await run("q.store.files.get(q.second.id).name")).toBe("Second, renamed");
    expect(await run("[q.told.named.at(-1), q.session.current().name]")).toEqual(["Second, renamed", "Second, renamed"]);
});

used("moving to another document saves what waits first, and leaving puts nothing in its place", async () => {
    await run("q.text.focus()");
    await page!.tab.type("Again. ");
    await run("q.session.leave()");
    expect(await run("q.store.files.get(q.second.id).text")).toContain("Again. ");
    expect(await run("[q.text.value, q.session.current().store === undefined, q.told.said.at(-1)]")).toEqual(["", true, ""]);
});
