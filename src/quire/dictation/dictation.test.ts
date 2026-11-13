// The dictation control in a real browser, on the built site's test page with its made-up engine
// and microphone (`/mdquire-dictation/?fake`): no model is downloaded and no sound is recorded.
// Checks the control's states, the first launch's dialog before a download, provisional words that are not
// in the document, settled text as undo steps, stopping itself after quiet, the spoken commands,
// custom words, the shortcut, and that nothing appears without a transition. Needs `bun run build`
// and a Chromium; skipped, with a notice, without either. It starts `astro preview` on port 4393
// if nothing is listening there, and stops it again.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { browser, chromium, type Browser } from "../../../scripts/browser";
import { at } from "../../../scripts/lib";

setDefaultTimeout(60000);
// another copy of the site being tested at once (a second checkout) can be given its own port
const PORT = Number(process.env.DICTATION_PORT ?? 4393);
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
    // Astro's preview carries on as a service of its own after the command that started it is gone, and refuses
    // to start a second: left running, later runs were served an old build. It is stopped by Astro's own command.
    if (server) spawnSync("bunx", ["astro", "preview", "stop"], { cwd: at("."), stdio: "ignore" });
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
/** Turns dictation on through the first launch's dialog and waits until it listens. */
async function listening() {
    await press(button("Start dictation"));
    await choose();
    await press(".quire-dictation-download");
    await until("window.dictation.state() === 'listening'", "listening", 8000);
}
/** Presses the first launch's "Choose" and waits for the three cards. */
async function choose() {
    await until("document.querySelector('dialog.quire-dialog .quire-dialog-action')?.textContent === 'Choose'", "the Choose button");
    await press("dialog.quire-dialog .quire-dialog-action");
    await until("document.querySelectorAll('.quire-dictation-card').length === 3 && document.querySelector('.quire-dictation-download')", "the three cards");
}

test.skipIf(!ready)("the first press opens a dialog in the middle of the screen that says no sound leaves the machine, and does not download until told", async () => {
    await fresh();
    expect(tab.errors).toEqual([]);
    expect(await run<string>("document.querySelector('.quire-dictate').getAttribute('aria-pressed')")).toBe("false");
    await press(button("Start dictation"));
    await until("window.dictation.state() === 'asking'", "asking");
    await until("document.querySelector('dialog.quire-dialog')?.open", "the dialog");
    const about = await run<{ modal: boolean; name: string; middle: number; said: string }>(`(() => { const d = document.querySelector('dialog.quire-dialog'); const r = d.getBoundingClientRect(); return { modal: d.matches(':modal'), name: document.getElementById(d.getAttribute('aria-labelledby')).textContent, middle: Math.abs(r.left + r.width / 2 - innerWidth / 2), said: d.querySelector('.quire-dictation-plain').textContent }; })()`);
    expect(about.modal).toBe(true);
    expect(about.name).toBe("Dictation");
    // the middle of the page, which keeps room for a scrollbar at its right
    expect(about.middle).toBeLessThan(10);
    expect(about.said).toContain("no sound leaves it");
    expect(await run("window.dictationTest.downloaded().length")).toBe(0);
    expect(await run("window.dictationTest.microphoneOpen()")).toBe(false);
    // Not now closes it, back into the microphone, and nothing was downloaded
    await run("[...document.querySelectorAll('.quire-dialog-dismiss')].find((each) => each.textContent === 'Not now').click()");
    await until("!document.querySelector('dialog.quire-dialog')", "closed");
    expect(await state()).toBe("off");
    expect(await run<string>("document.activeElement.className")).toContain("quire-dictate");
});

test.skipIf(!ready)("Choose becomes the three models as cards, each with its size and who it suits, the chosen one picked, and a pick is kept", async () => {
    await fresh();
    await press(button("Start dictation"));
    await choose();
    const cards = await run<{ name: string; size: string; who: string; checked: string | null }[]>("[...document.querySelectorAll('.quire-dictation-card')].map((each) => ({ name: each.querySelector('.quire-dictation-card-name').firstChild.textContent, size: each.querySelector('.quire-dictation-card-size').textContent, who: each.querySelector('.quire-dictation-card-who').textContent, checked: each.getAttribute('aria-checked') }))");
    expect(cards.map((each) => [each.name, each.size])).toEqual([["Accurate", "402 MB"], ["Light", "208 MB"], ["Tiny", "55 MB"]]);
    for (const each of cards) expect(each.who.length).toBeGreaterThan(5);
    // the page chose tiny before it opened
    expect(cards.map((each) => each.checked)).toEqual(["false", "false", "true"]);
    // one card says it suits this machine
    expect(await run<number>("document.querySelectorAll('.quire-dictation-card-tag').length")).toBe(1);
    await press(".quire-dictation-card[data-tier=light]");
    expect(await run("localStorage.getItem('mdquire-dictation-tier')")).toBe("light");
    expect(await run<string>("document.querySelector('.quire-dictation-card[aria-checked=true]').dataset.tier")).toBe("light");
    // the arrow keys go between them, as in any group of choices
    await run("document.querySelector('.quire-dictation-card[aria-checked=true]').focus()");
    await tab.press("ArrowRight");
    expect(await run<string>("document.activeElement.dataset.tier")).toBe("tiny");
    expect(await run("localStorage.getItem('mdquire-dictation-tier')")).toBe("tiny");
    await tab.press("Escape");
    await until("!document.querySelector('dialog.quire-dialog')", "closed by Escape");
});

test.skipIf(!ready)("the three models are offered with their sizes in the panel too, and the choice is kept", async () => {
    await fresh();
    await press(button("Dictation settings"));
    await until("document.querySelectorAll('.quire-dictation-tier').length === 3", "three tiers");
    const sizes = await run<string[]>("[...document.querySelectorAll('.quire-dictation-tier-size')].map((each) => each.textContent)");
    expect(sizes).toEqual(["402 MB", "208 MB", "55 MB"]);
    await press('.quire-dictation-tier:nth-child(2)');
    expect(await run("localStorage.getItem('mdquire-dictation-tier')")).toBe("light");
    expect(await run<string>("document.querySelector('.quire-dictation-tier[aria-checked=true] .quire-dictation-tier-name').textContent")).toBe("Light");
});

test.skipIf(!ready)("a download shows its progress in the dialog, can be cancelled there, and then carries on", async () => {
    await fresh();
    await run("window.dictationTest.downloadTime = 3000");
    await press(button("Start dictation"));
    await choose();
    await press(".quire-dictation-download");
    await until("window.dictation.state() === 'downloading'", "downloading");
    await until("document.querySelector('dialog.quire-dialog .quire-dictation-count')?.textContent.includes(' of 55 MB')", "a progress line in the dialog");
    expect(await run<string>("document.querySelector('dialog.quire-dialog .quire-dictation-progress').style.getPropertyValue('--done')")).toMatch(/%$/);
    await press(".quire-dictation-cancel");
    await until("window.dictation.state() === 'off'", "cancelled");
    await until("document.querySelector('dialog.quire-dialog .quire-dictation-warn')", "the line saying so");
    expect(await text("dialog.quire-dialog .quire-dictation-warn")).toContain("cancelled");
    expect(await run("window.dictationTest.downloaded().length")).toBe(0);
    // the choice is offered again, and this time it downloads and listens, the dialog put away
    await run("window.dictationTest.downloadTime = 300");
    await press(".quire-dictation-download");
    await until("window.dictation.state() === 'listening'", "listening", 8000);
    await until("!document.querySelector('dialog.quire-dialog')", "the dialog put away");
    await run("window.dictation.toggle()");
});

test.skipIf(!ready)("closing the dialog during a download cancels it, and a download that finishes anyway never opens the microphone", async () => {
    await fresh();
    await run("window.dictationTest.downloadTime = 1500");
    await press(button("Start dictation"));
    await choose();
    await press(".quire-dictation-download");
    await until("window.dictation.state() === 'downloading'", "downloading");
    await tab.press("Escape");
    await until("window.dictation.state() === 'off'", "cancelled by closing the dialog");
    await tab.wait(1800);
    expect(await run("window.dictationTest.downloaded().length")).toBe(0);
    expect(await run("window.dictationTest.opened()")).toBe(0);
    // a cancel that comes too late: the download ends after the dialog has gone
    await run("window.dictationTest.cancellable = false");
    await press(button("Start dictation"));
    await choose();
    await press(".quire-dictation-download");
    await until("window.dictation.state() === 'downloading'", "downloading again");
    await tab.press("Escape");
    await until("window.dictationTest.downloaded().length === 1", "the download ended anyway", 4000);
    await tab.wait(500);
    expect(await state()).toBe("off");
    expect(await run("window.dictationTest.opened()")).toBe(0);
    expect(await run("window.dictationTest.microphoneOpen()")).toBe(false);
});

test.skipIf(!ready)(
    "every way out of dictation closes the microphone once, leaves no answer waiting, and says it stopped once",
    async () => {
        const ways: [string, string][] = [
            ["the button", "window.dictation.toggle()"],
            ["a press again while it is starting", "window.dictation.toggle(); window.dictation.toggle()"],
            ["an error in recognizing", "window.dictationTest.fail = 'error'; window.dictationTest.quiet(1200)"],
            ["the worker dying", "window.dictationTest.fail = 'dead'; window.dictationTest.quiet(1200)"],
            ["the tab hidden", "Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange'))"],
            ["the page being left", "dispatchEvent(new Event('pagehide'))"],
            ["the microphone's permission withdrawn", "window.dictationTest.takeAway()"],
            ["quiet after speech", "window.dictationTest.quiet(3500)"],
            ["the spoken command", "window.dictationTest.quiet(1000).then(() => window.dictationTest.speak(1500, 0.5)).then(() => window.dictationTest.quiet(1000))"],
        ];
        for (const [what, how] of ways) {
            await fresh();
            await listening();
            // in the middle of a phrase, so that there is something left to recognize as it ends
            await run("window.dictationTest.speak(2400, 0.2)");
            if (what === "a press again while it is starting") {
                await run("window.dictation.toggle()");
                await until("window.dictation.state() === 'off'", `${what}: off before`);
                await run("window.dictationTest.quiet(100)");
            }
            const stoppedBefore = await run<number>("window.dictationTest.stopped()");
            await run(how);
            await until("window.dictation.state() === 'off'", `${what}: off`, 8000);
            await tab.wait(300);
            const after = await run<{ open: boolean; opened: number; closed: number; pending: number; stopped: number }>("({ open: window.dictationTest.microphoneOpen(), opened: window.dictationTest.opened(), closed: window.dictationTest.closed(), pending: window.dictationTest.pending(), stopped: window.dictationTest.stopped() })");
            expect({ what, ...after, stopped: after.stopped - stoppedBefore }).toEqual({ what, open: false, opened: after.opened, closed: after.opened, pending: 0, stopped: 1 });
        }
    },
    240000,
);

test.skipIf(!ready)("taking dictation down closes the microphone at once, still writes the last phrase, then ends the engine; a download under way is cancelled", async () => {
    await fresh();
    await listening();
    await run("window.dictationTest.speak(3000, 0.2)");
    await run("window.dictation.destroy()");
    expect(await run("window.dictationTest.microphoneOpen()")).toBe(false);
    await until("window.dictationTest.markdown() !== ''", "the last phrase written");
    expect(await markdown()).toBe("Hello there my dear friend.");
    await until("window.dictationTest.disposed() === 1", "the engine ended");
    expect(await run("window.dictationTest.pending()")).toBe(0);
    await fresh();
    await run("window.dictationTest.downloadTime = 1500");
    await press(button("Start dictation"));
    await choose();
    await press(".quire-dictation-download");
    await until("window.dictation.state() === 'downloading'", "downloading");
    await run("window.dictation.destroy()");
    await tab.wait(1800);
    expect(await run("window.dictationTest.downloaded().length")).toBe(0);
    expect(await run("window.dictationTest.opened()")).toBe(0);
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
    // the panel is the site's flowing menu, which grows from the button: it is moving as it opens
    await press(button("Dictation settings"));
    expect(await run<number>("document.querySelector('.quire-dictation-menu').getAnimations().length")).toBeGreaterThan(0);
    await until("document.querySelector('.quire-menu.open')", "the panel");
});

test.skipIf(!ready)("the control is absent, with a line saying why, where nothing can run it", async () => {
    // the test page told that this browser cannot dictate, as one without a microphone or WebAssembly is
    await tab.open(`${PAGE}&none`, 400);
    await until("window.dictation", "the page is ready");
    expect(await run<string>("window.dictation.why")).toBe("Dictation cannot run in this test.");
    expect(await run<number>("document.querySelectorAll('.quire-dictate, .quire-dictate-more').length")).toBe(0);
    expect(await text(".dictation-why")).toBe("Dictation cannot run in this test.");
    expect(await run<string>("window.dictation.state()")).toBe("off");
});
