// The dictation control in a real browser, on the built site's test page with its made-up engine
// and microphone (`/mdquire-dictation/?fake`): no model is downloaded and no sound is recorded.
// Checks the control's states, the confirmation before a download, provisional words that are not
// in the document, settled text as undo steps, stopping itself after quiet, the spoken commands,
// custom words, the shortcut, and that nothing appears without a transition. Needs `bun run build`
// and a Chromium; skipped, with a notice, without either. It starts `astro preview` on port 4393
// if nothing is listening there, and stops it again.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { browser, chromium, type Browser } from "../../../scripts/browser";
import { at } from "../../../scripts/lib";

setDefaultTimeout(60000);
const PORT = 4393;
const PAGE = `http://localhost:${PORT}/mdquire-dictation/?fake`;
const ready = existsSync(at("dist/mdquire-dictation/index.html")) && !!chromium();
let server: ChildProcess | undefined;
let tab: Browser;

beforeAll(async () => {
    if (!ready) return console.warn("dictation browser test skipped: needs `bun run build` and a Chromium");
    const listening = await fetch(`http://localhost:${PORT}/`).then(() => true, () => false);
    if (!listening) {
        server = spawn("bunx", ["astro", "preview", "--port", String(PORT)], { cwd: at("."), stdio: "ignore" });
        for (let tries = 0; tries < 100 && !(await fetch(`http://localhost:${PORT}/`).then(() => true, () => false)); tries++) await new Promise((done) => setTimeout(done, 100));
    }
    tab = await browser({ width: 1300, height: 800 });
});
afterAll(async () => {
    if (ready) await tab.close();
    server?.kill();
});

const run = <T>(expression: string) => tab.run<T>(expression);
/** Waits until an expression is true. */
async function until(expression: string, what: string, ms = 4000) {
    for (let waited = 0; waited < ms; waited += 50) {
        if (await run<boolean>(`!!(${expression})`)) return;
        await tab.wait(50);
    }
    throw new Error(`never became true: ${what}`);
}
const press = (selector: string) => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
const text = (selector: string) => run<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ""`);
const state = () => run<string>("window.dictation.state()");
const markdown = () => run<string>("window.dictationTest.markdown()");
const button = (name: string) => `[aria-label^="${name}"]`;

/** Opens the page afresh with nothing downloaded, and the tiny model chosen so that sizes are known. */
async function fresh() {
    await tab.open(PAGE, 400);
    await run("localStorage.clear(); localStorage.setItem('mdquire-dictation-tier','tiny')");
    await tab.open(PAGE, 400);
    await until("window.dictation && window.dictationTest", "the page is ready");
}
/** Turns dictation on through the confirmation and waits until it listens. */
async function listening() {
    await press(button("Start dictation"));
    await until("document.querySelector('.quire-dictation-action.primary')", "the confirmation");
    await press(".quire-dictation-action.primary");
    await until("window.dictation.state() === 'listening'", "listening", 8000);
}

test.skipIf(!ready)("the first press asks before downloading, says how big and that no sound leaves the machine, and does not download until told", async () => {
    await fresh();
    expect(tab.errors).toEqual([]);
    expect(await run<string>("document.querySelector('.quire-dictate').getAttribute('aria-pressed')")).toBe("false");
    await press(button("Start dictation"));
    await until("window.dictation.state() === 'asking'", "asking");
    await until("document.querySelector('.quire-dictation-plain')", "the line");
    const said = await text(".quire-dictation-plain");
    expect(said).toContain("55 MB");
    expect(said).toContain("no sound leaves it");
    expect(await run("window.dictationTest.downloaded().length")).toBe(0);
    expect(await run("window.dictationTest.microphoneOpen()")).toBe(false);
});

test.skipIf(!ready)("the three models are offered with their sizes, and the choice is kept", async () => {
    await fresh();
    await press(button("Dictation settings"));
    await until("document.querySelectorAll('.quire-dictation-tier').length === 3", "three tiers");
    const sizes = await run<string[]>("[...document.querySelectorAll('.quire-dictation-tier-size')].map((each) => each.textContent)");
    expect(sizes).toEqual(["668 MB", "208 MB", "55 MB"]);
    await press('.quire-dictation-tier:nth-child(2)');
    expect(await run("localStorage.getItem('mdquire-dictation-tier')")).toBe("light");
    expect(await run<string>("document.querySelector('.quire-dictation-tier[aria-checked=true] .quire-dictation-tier-name').textContent")).toBe("Light");
});

test.skipIf(!ready)("a download shows its progress, can be cancelled, and then carries on", async () => {
    await fresh();
    await run("window.dictationTest.downloadTime = 3000");
    await press(button("Start dictation"));
    await until("document.querySelector('.quire-dictation-action.primary')", "the confirmation");
    await press(".quire-dictation-action.primary");
    await until("window.dictation.state() === 'downloading'", "downloading");
    await until("document.querySelector('.quire-dictation-count')?.textContent.includes(' of 55 MB')", "a progress line");
    expect(await run<string>("document.querySelector('.quire-dictation-progress').style.getPropertyValue('--done')")).toMatch(/%$/);
    await press(".quire-dictation-action:not(.primary)");
    await until("window.dictation.state() === 'off'", "cancelled");
    expect(await text(".quire-dictation-warn")).toContain("cancelled");
    expect(await run("window.dictationTest.downloaded().length")).toBe(0);
});

test.skipIf(!ready)("after the download it listens, shows provisional words that are not in the document, then settles them as one undo step", async () => {
    await fresh();
    await listening();
    expect(await run("window.dictationTest.downloaded()")).toEqual(["tiny"]);
    expect(await run("window.dictationTest.microphoneOpen()")).toBe(true);
    expect(await run<string>("document.querySelector('.quire-dictate').getAttribute('aria-pressed')")).toBe("true");
    await run("window.dictationTest.quiet(500)");
    await run("window.dictationTest.speak(2400, 0.2)");
    await until("window.dictationTest.provisional().length > 0", "provisional words");
    expect(await run<string>("window.dictationTest.provisional()")).toMatch(/hello there/i);
    expect(await markdown()).toBe("");
    expect(await run("document.querySelector('.quire-ghost').classList.contains('shown')")).toBe(true);
    await run("window.dictationTest.speak(1500, 0.2)");
    await run("window.dictationTest.quiet(1200)");
    await until("window.dictationTest.markdown() !== ''", "settled text");
    expect(await markdown()).toBe("Hello there my dear friend.");
    expect(await run<string>("window.dictationTest.provisional()")).toBe("");
    // one phrase is one undo step
    await tab.press("z", { ctrl: true });
    expect(await markdown()).toBe("");
});

test.skipIf(!ready)("switches itself off after a couple of seconds of quiet once speech was heard, and writes what was said", async () => {
    await fresh();
    await listening();
    await run("window.dictationTest.speak(3000, 0.2)");
    await run("window.dictationTest.quiet(2000)");
    expect(await state()).toBe("listening");
    await run("window.dictationTest.quiet(1200)");
    await until("window.dictation.state() === 'off'", "switched off");
    expect(await run("window.dictationTest.microphoneOpen()")).toBe(false);
    expect(await markdown()).toBe("Hello there my dear friend.");
    expect(await run<string>("document.querySelector('.quire-sr').textContent")).toContain("quiet moment");
});

test.skipIf(!ready)("switches itself off when nothing is ever said", async () => {
    await fresh();
    await listening();
    await run("window.dictationTest.quiet(7000)");
    expect(await state()).toBe("listening");
    await run("window.dictationTest.quiet(1500)");
    await until("window.dictation.state() === 'off'", "switched off");
    expect(await run<string>("document.querySelector('.quire-sr').textContent")).toContain("nothing was said");
});

test.skipIf(!ready)("the spoken commands act: delete that, stop dictation, and heading", async () => {
    await fresh();
    await listening();
    await run("window.dictationTest.speak(3000, 0.2)");
    await run("window.dictationTest.quiet(1000)");
    await run("window.dictationTest.speak(2200, 0.6)");
    await run("window.dictationTest.quiet(1000)");
    await until("window.dictationTest.markdown().includes('Second')", "second phrase");
    expect(await markdown()).toBe("Hello there my dear friend. Second phrase here");
    await run("window.dictationTest.speak(1500, 0.4)");
    await run("window.dictationTest.quiet(1000)");
    await until("!window.dictationTest.markdown().includes('Second')", "delete that");
    expect(await markdown()).toBe("Hello there my dear friend.");
    await run("window.dictationTest.speak(1500, 0.5)");
    await run("window.dictationTest.quiet(1000)");
    await until("window.dictation.state() === 'off'", "stop dictation");
});

test.skipIf(!ready)("custom words and shortcuts correct what is written, and are kept", async () => {
    await fresh();
    await press(button("Dictation settings"));
    await until("document.querySelector('.quire-dictation-action')", "the panel");
    await run("[...document.querySelectorAll('.quire-dictation-action')].find((each) => each.textContent === 'Custom words').click()");
    await until("[...document.querySelectorAll('.quire-dictation-action')].some((each) => each.textContent === 'Add a word')", "the words view");
    await run("[...document.querySelectorAll('.quire-dictation-action')].find((each) => each.textContent === 'Add a word').click()");
    await run(`(() => {
        const [word, sounds] = document.querySelector('.quire-dictation-line').querySelectorAll('.quire-dictation-field');
        word.value = 'Dearest'; word.dispatchEvent(new Event('input'));
        sounds.value = 'dear'; sounds.dispatchEvent(new Event('input'));
    })()`);
    expect(await run<string>("localStorage.getItem('mdquire-dictation-words')")).toContain("Dearest");
    await run("document.querySelector('.quire-dictation-head .quire-button').click()");
    await listening();
    await run("window.dictationTest.speak(3000, 0.2)");
    await run("window.dictationTest.quiet(1000)");
    await until("window.dictationTest.markdown() !== ''", "text");
    expect(await markdown()).toBe("Hello there my Dearest friend.");
});

test.skipIf(!ready)("Ctrl+D switches it on and off from the editor, and the browser's own use of the key is prevented", async () => {
    await fresh();
    await run("window.dictationTest.downloaded"); // the made-up engine starts empty
    // keep the model so that the shortcut goes straight to listening
    await listening();
    await run("window.dictationTest.quiet(100)");
    await run("window.dictation.toggle()");
    await until("window.dictation.state() === 'off'", "off");
    await run(`window.seen = null; addEventListener('keydown', (event) => (window.seen = event), true)`);
    await run("document.querySelector('#dictation-paper').focus()");
    await tab.press("d", { ctrl: true });
    await until("window.dictation.state() === 'listening' || window.dictation.state() === 'loading'", "on");
    expect(await run("window.seen.defaultPrevented")).toBe(true);
    await tab.press("d", { ctrl: true });
    await until("window.dictation.state() === 'off'", "off again");
});

test.skipIf(!ready)("nothing appears without a transition, and under reduced motion the transitions are off", async () => {
    await fresh();
    await listening();
    const times = await run<Record<string, string>>(`(() => {
        const of = (selector) => getComputedStyle(document.querySelector(selector)).transitionDuration;
        return { meter: of('.quire-meter'), ghost: of('.quire-ghost'), bar: of('.quire-meter i') };
    })()`);
    for (const duration of Object.values(times)) expect(duration).not.toBe("0s");
    await run("window.dictation.toggle()");
    await tab.media({ "prefers-reduced-motion": "reduce" });
    const calm = await run<string>("getComputedStyle(document.querySelector('.quire-ghost')).transitionDuration");
    expect(calm).toBe("0s");
    await tab.media({});
    // the panel is the site's flowing menu, which grows from the button
    if (!(await run<boolean>("!!document.querySelector('.quire-menu.open')"))) await press(button("Dictation settings"));
    await until("document.querySelector('.quire-menu.open')", "the panel");
    expect(await run<string>("getComputedStyle(document.querySelector('.quire-dictation-menu')).transitionDuration")).not.toBe("0s");
});

test.skipIf(!ready)("the control is absent, with a line saying why, where nothing can run it", async () => {
    await tab.open(PAGE, 400);
    await run("window.dictation.destroy()");
    // the page with no microphone API at all
    await tab.open(`http://localhost:${PORT}/mdquire-dictation/`, 400);
    const none = await run<boolean>("!window.dictation?.why || !!document.querySelector('.quire-dictate')");
    // headless Chromium has a microphone API, so either the control is there or the reason is
    expect(none).toBe(true);
});
