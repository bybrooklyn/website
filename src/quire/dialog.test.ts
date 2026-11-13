// What the dialog is held to. Its counting: the insets that lay its skin over the control it grows
// from, and where a press's ripple starts. And in headless Chromium, on a page with the site's
// styles: it is a modal dialog named by its title; its first frame is the pressed control's box and
// its last closing frame is too; focus goes in, goes round inside, and comes back to the control;
// Escape and a press outside close it, a press inside does not; one is open at a time; it eases to
// a new size when what is inside changes; and under reduced motion it is simply open or shut.
// The browser part is skipped, with a notice, on a machine with no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium, type Browser } from "../../scripts/browser";
import { insetOf, rippleFrom } from "./dialog";

test("the insets cut the dialog's box down to the control's, negative where the control is outside it", () => {
    const dialog = { left: 100, top: 100, width: 400, height: 300 };
    expect(insetOf(dialog, { left: 150, top: 120, width: 40, height: 40 })).toEqual([20, 310, 240, 50]);
    expect(insetOf(dialog, dialog)).toEqual([0, 0, 0, 0]);
    // a microphone at the window's top right, outside a dialog in the middle
    expect(insetOf(dialog, { left: 600, top: 10, width: 30, height: 30 })).toEqual([-90, -130, 360, 500]);
});

test("a ripple starts where the button was pressed and reaches its farthest corner", () => {
    const button = { left: 0, top: 0, width: 100, height: 40 };
    const at = rippleFrom(button, 10, 20);
    expect(at.left + at.size / 2).toBe(10);
    expect(at.top + at.size / 2).toBe(20);
    expect(at.size / 2).toBeCloseTo(Math.hypot(90, 20));
});

const live = !!chromium();
let folder = "";
let tab: Browser;

const page = `
import { openDialog } from "${import.meta.dir}/dialog.ts";
const opener = document.querySelector("#opener");
window.shut = 0;
window.show = (title = "Asking") => {
    const line = document.createElement("p");
    line.textContent = "A line saying what is asked.";
    const field = document.createElement("input");
    field.setAttribute("aria-label", "A field");
    window.dialog = openDialog(opener, { title, body: [line, field], dismiss: "Not now", action: { label: "Choose", press: (button, dialog) => dialog.change(() => { const cards = document.createElement("div"); cards.className = "cards"; cards.style.height = "12rem"; button.replaceWith(cards); return cards; }, button) }, onClose: () => window.shut++ });
};
opener.addEventListener("click", () => window.show());
`;

beforeAll(async () => {
    if (!live) return console.warn("dialog browser test skipped: needs a Chromium");
    folder = await mkdtemp(join(tmpdir(), "quire-dialog-"));
    await Bun.write(`${folder}/page.ts`, page);
    const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const styles = `${import.meta.dir}/../styles`;
    const theme = ":root{--ground:oklch(0.16 0.035 300);--surface:oklch(0.21 0.045 300);--rule:oklch(0.32 0.055 300);--ink:oklch(0.93 0.02 300);--muted:oklch(0.73 0.045 300);--accent:oklch(0.77 0.16 300)}";
    const css = (await Promise.all(["tokens.css", "base.css", "quire.css"].map((name) => Bun.file(`${styles}/${name}`).text()))).join("\n");
    await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><style>${css}${theme}</style><body class="quire-app"><button id="opener" style="position:fixed;right:40px;top:30px;width:36px;height:36px;border-radius:8px">M</button><button id="other" style="position:fixed;left:20px;top:30px">Other</button><script type="module">${await built.outputs[0]!.text()}</script></body>`);
    tab = await browser({ width: 1200, height: 800 });
    await tab.open(`file://${folder}/page.html`, 200);
    if (tab.errors.length) throw new Error(tab.errors.join("\n"));
}, 60_000);

afterAll(async () => {
    if (!live) return;
    await tab?.close();
    await rm(folder, { recursive: true, force: true });
});

const run = <T>(expression: string) => tab.run<T>(expression);
const opened = () => run<boolean>("!!document.querySelector('dialog.quire-dialog')?.open");
async function until(expression: string, what: string, ms = 2000) {
    for (let waited = 0; waited < ms; waited += 25) {
        if (await run<boolean>(`!!(${expression})`)) return;
        await tab.wait(25);
    }
    throw new Error(`never became true: ${what}`);
}
/** Presses the opener with the keyboard, as someone would, so that focus starts on it. */
async function show() {
    await run("document.querySelector('#opener').focus(); document.querySelector('#opener').click()");
    await until("document.querySelector('dialog.quire-dialog')?.open", "the dialog");
}

const used = (name: string, run: () => Promise<void>) => test.skipIf(!live)(name, run, 30_000);

used("it is a modal dialog, named by its title, the rest of the page shut off while it is open", async () => {
    await show();
    const about = await run<{ modal: boolean; name: string; role: string }>(`(() => { const d = document.querySelector('dialog.quire-dialog'); return { modal: d.matches(':modal'), name: document.getElementById(d.getAttribute('aria-labelledby')).textContent, role: d.tagName }; })()`);
    expect(about).toEqual({ modal: true, name: "Asking", role: "DIALOG" });
    // something outside cannot be focused while it is open
    await run("document.querySelector('#other').focus()");
    expect(await run<string>("document.activeElement.id")).not.toBe("other");
    await run("window.dialog.close()");
    await until("!document.querySelector('dialog.quire-dialog')", "closed");
});

used("its first frame is the pressed control's box, and its last closing frame is too", async () => {
    // the motions are paused at their ends to read the skin's box
    await run("document.querySelector('#opener').click()");
    const first = await run<number[]>(`(() => { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 0; }); const s = document.querySelector('.quire-dialog-skin').getBoundingClientRect(); return [s.left, s.top, s.width, s.height]; })()`);
    const control = await run<number[]>(`(() => { const r = document.querySelector('#opener').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
    first.forEach((value, index) => expect(value).toBeCloseTo(control[index]!, 0));
    await run("document.getAnimations().forEach((a) => a.finish())");
    const whole = await run<number[]>(`(() => { const s = document.querySelector('.quire-dialog-skin').getBoundingClientRect(); const d = document.querySelector('dialog').getBoundingClientRect(); return [s.width - d.width, s.height - d.height]; })()`);
    expect(whole).toEqual([0, 0]);
    void run("window.dialog.close()");
    const last = await run<number[]>(`(() => { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = a.effect.getComputedTiming().endTime - 0.01; }); const s = document.querySelector('.quire-dialog-skin').getBoundingClientRect(); return [s.left, s.top, s.width, s.height]; })()`);
    last.forEach((value, index) => expect(value).toBeCloseTo(control[index]!, 0));
    await run("document.getAnimations().forEach((a) => a.finish())");
    await until("!document.querySelector('dialog.quire-dialog')", "closed");
});

used("focus goes into it, goes round inside with Tab, and comes back to the control when it closes", async () => {
    await show();
    expect(await run<string>("document.activeElement.textContent")).toBe("Choose");
    const seen: string[] = [];
    for (let step = 0; step < 4; step++) {
        await tab.press("Tab");
        seen.push(await run<string>("document.activeElement.closest('dialog') ? (document.activeElement.textContent || document.activeElement.getAttribute('aria-label')) : 'outside'"));
    }
    expect(seen).toEqual(["A field", "Not now", "Choose", "A field"]);
    await tab.press("Escape");
    await until("!document.querySelector('dialog.quire-dialog')", "closed by Escape");
    expect(await run<string>("document.activeElement.id")).toBe("opener");
});

used("a press outside closes it and a press inside does not", async () => {
    await show();
    const box = await run<{ left: number; top: number; width: number; height: number }>("(() => { const r = document.querySelector('dialog').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()");
    await tab.click(box.left + box.width / 2, box.top + 20);
    await tab.wait(300);
    expect(await opened()).toBe(true);
    const before = await run<number>("window.shut");
    await tab.click(40, box.top + box.height + 40);
    await until("!document.querySelector('dialog.quire-dialog')", "closed by a press outside");
    expect(await run<number>("window.shut")).toBe(before + 1);
});

used("one is open at a time: opening another closes the first", async () => {
    await show();
    await run("window.show('Second')");
    await until("document.querySelectorAll('dialog.quire-dialog').length === 1", "one dialog");
    expect(await run<string>("document.querySelector('dialog.quire-dialog .quire-dialog-title').textContent")).toBe("Second");
    await run("window.dialog.close()");
    await until("!document.querySelector('dialog.quire-dialog')", "closed");
});

used("the button becomes what it opens, and the dialog eases to its new size", async () => {
    await show();
    const before = await run<number>("document.querySelector('dialog').getBoundingClientRect().height");
    await run("[...document.querySelectorAll('.quire-dialog-action')].find((b) => b.textContent === 'Choose').click()");
    const moving = await run<{ skin: number; sweep: boolean }>(`(() => { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 0; }); return { skin: document.querySelector('.quire-dialog-skin').getBoundingClientRect().height, sweep: !!document.querySelector('.quire-dialog-sweep') }; })()`);
    // at its first frame the skin is still the old size, and the button's colour is laid where it was
    expect(moving.skin).toBeCloseTo(before, 0);
    expect(moving.sweep).toBe(true);
    await run("document.getAnimations().forEach((a) => a.finish())");
    expect(await run<number>("document.querySelector('.quire-dialog-skin').getBoundingClientRect().height")).toBeGreaterThan(before);
    await run("window.dialog.close()");
    await until("!document.querySelector('dialog.quire-dialog')", "closed");
});

used("under reduced motion it is simply open, and simply shut", async () => {
    await tab.media({ "prefers-reduced-motion": "reduce" });
    await show();
    expect(await run<number>("document.getAnimations().length")).toBe(0);
    await run("window.dialog.close()");
    expect(await run<boolean>("!document.querySelector('dialog.quire-dialog')")).toBe(true);
    await tab.media({});
});
