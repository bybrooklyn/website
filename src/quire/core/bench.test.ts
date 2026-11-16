// What the small tools' shared parts are held to (bench.ts), in Chromium: a box has the work's side with
// its one line last in it and a column beside; a thing held goes in over the line; what is said shows in
// the line, and while it is busy the line says what is being done; a word to press runs what it was
// given and a quiet one is marked so; a group has its small heading and a stack is marked to stand its
// words one under another; a row of dots tells the tool the word pressed, also when it is the one
// already chosen, while the dots show only what the tool last said is chosen, so a choice that was
// refused never shows as made; a row is a small label and what it names; a line to type on tells what
// is typed; a slider says its value in the tool's words; a number steps by one and stops at its ends;
// and a color picked is told, and ringed once the tool shows it. Run with
// `bun test src/quire/core/bench.test.ts`.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { lowered, raised } from "./bench";

test("a label is lowercase but for names, which keep their capitals, and a menu's line has a first capital", () => {
    expect(["Save PNG", "PNG size", "Network name", "Wi-Fi", "Link or text", "JPEG XL", "WebP", "Opus Ogg", "AAC M4A", "48 kHz", "0.5 Mbps", "What HTML is understood", "Connect a GitHub repository", "Save to Google Drive", "Markdown", "As it came"].map(lowered)).toEqual(["save PNG", "PNG size", "network name", "Wi-Fi", "link or text", "JPEG XL", "WebP", "Opus Ogg", "AAC M4A", "48 kHz", "0.5 Mbps", "what HTML is understood", "connect a GitHub repository", "save to Google Drive", "Markdown", "as it came"]);
    // what is already so is left as it is
    for (const each of ["save PNG", "copy", "choose another picture", "Wi-Fi"]) expect(lowered(each)).toBe(each);
    expect(["choose files", "paste", "save as SVG", "Copy"].map(raised)).toEqual(["Choose files", "Paste", "Save as SVG", "Copy"]);
});

test("in Chromium, a tool's box, its words to press and its rows of dots are built as said, and the dots show what the tool says is chosen", async () => {
    const page = await corePage(`
        import { bench, count, dots, group, slide, stack, swatches, typed, word } from "${quire}/core/bench.ts";
        const box = bench("Try", "try-tool");
        document.querySelector("#host").append(box.root);
        const held = document.createElement("div");
        held.className = "held";
        box.hold(held);
        window.pressed = [];
        const laid = dots("background", [{ value: "clear", text: "clear", tip: "Nothing behind it" }, { value: "color", text: "color" }], (value) => {
            window.pressed.push(value);
            // "color" is refused: the tool goes on saying "clear" is chosen
            laid.show(value === "color" ? "clear" : value);
        });
        const brush = dots("touch up", [{ value: "keep", text: "keep" }], (value) => {
            window.pressed.push(value);
            window.held = window.held === value ? undefined : value;
            brush.show(window.held);
        });
        laid.show("clear");
        const copy = word("copy", () => window.pressed.push("copy"));
        const save = word("save", () => window.pressed.push("save"), true);
        box.side.append(laid.group, brush.group, group(undefined, copy, save), stack("more", word("choose another picture", () => {}, true)));
        // the parts that hold a value: a line to type on, a slider, a number with less and more, and a row of colors
        window.told = [];
        const name = typed("name", (value) => window.told.push(["name", value]), { hint: "The network's name" });
        const words = typed("text", () => {}, { many: true });
        const quality = slide("quality", { min: 1, max: 100 }, (value) => window.told.push(["quality", value]), (value) => value + " of 100");
        const margin = count("margin", { min: 0, max: 2 }, (value) => window.told.push(["margin", value]));
        const colors = swatches("ground", [{ name: "White", value: "#ffffff" }, { name: "Black", value: "#000000" }], (value) => (window.told.push(["ground", value]), colors.show(value)));
        quality.set(85);
        margin.set(1);
        box.side.append(group("more parts", name.row, words.row, quality.row, margin.row, colors.set));
        window.box = box;
        window.ready = true;
    `);
    if (!page) return;
    const { tab } = page;
    try {
        for (let waited = 0; waited < 100 && !(await tab.run<boolean>("window.ready === true")); waited++) await tab.wait(100);
        expect(await tab.run("[document.querySelector('.quire-bench').className, [...document.querySelector('.quire-bench').children].map((each) => each.className), [...document.querySelector('.quire-bench-work').children].map((each) => each.className), document.querySelector('.quire-bench-side').getAttribute('aria-label')]")).toEqual(["quire-bench try-tool", ["quire-bench-work", "quire-bench-side"], ["held", "quire-bench-status"], "Try"]);
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-group')].slice(0, 4).map((each) => [each.className, each.querySelector('.quire-bench-heading')?.textContent ?? '', [...each.querySelectorAll('label, button')].map((part) => part.textContent)])")).toEqual([
            ["quire-bench-group", "background", ["clear", "color"]],
            ["quire-bench-group", "touch up", ["keep"]],
            ["quire-bench-group", "", ["copy", "save"]],
            ["quire-bench-group quire-bench-stack", "more", ["choose another picture"]],
        ]);
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-group:not(:last-child) .quire-bench-press')].map((each) => [each.type, each.classList.contains('quiet')])")).toEqual([["button", false], ["button", true], ["button", true]]);
        // a row is a small label and what it names; a line to type on tells what is typed; a slider says its value in the tool's words
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-row')].map((each) => [each.className, each.querySelector('.quire-bench-label').textContent, each.querySelector('.quire-bench-held').firstElementChild.tagName])")).toEqual([
            ["quire-bench-row", "name", "INPUT"],
            ["quire-bench-row wide", "text", "TEXTAREA"],
            ["quire-bench-row", "quality", "INPUT"],
            ["quire-bench-row quire-bench-counted", "margin", "BUTTON"],
        ]);
        await tab.run("(() => { const input = document.querySelector('input.quire-bench-typed'); input.value = 'home'; input.dispatchEvent(new Event('input', { bubbles: true })); const slider = document.querySelector('.quire-bench-slide'); slider.value = '40'; slider.dispatchEvent(new Event('input', { bubbles: true })); })()");
        expect(await tab.run("[document.querySelector('input.quire-bench-typed').placeholder, document.querySelector('.quire-bench-slide + .quire-bench-value').textContent]")).toEqual(["The network's name", "40 of 100"]);
        // less and more step by one and stop at the ends, where the one that can go no further is out of reach
        const counted = () => tab.run("[document.querySelector('.quire-bench-count').textContent, ...[...document.querySelectorAll('.quire-bench-counted button')].map((each) => each.disabled)]");
        expect(await counted()).toEqual(["1", false, false]);
        await tab.run("document.querySelectorAll('.quire-bench-counted button')[1].click()");
        await tab.run("document.querySelectorAll('.quire-bench-counted button')[1].click()");
        expect(await counted()).toEqual(["2", false, true]);
        await tab.run("document.querySelectorAll('.quire-bench-counted button')[0].click()");
        await tab.run("document.querySelectorAll('.quire-bench-counted button')[0].click()");
        await tab.run("document.querySelectorAll('.quire-bench-counted button')[0].click()");
        expect(await counted()).toEqual(["0", true, false]);
        // a color picked is told, and ringed once the tool shows it
        await tab.run("document.querySelector('.quire-bench-swatch[data-color=\"#000000\"]').click()");
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-swatch')].map((each) => [each.title, each.getAttribute('aria-pressed')])")).toEqual([["White", "false"], ["Black", "true"]]);
        expect(await tab.run("window.told")).toEqual([["name", "home"], ["quality", 40], ["margin", 2], ["margin", 1], ["margin", 0], ["ground", "#000000"]]);
        expect(await tab.run("[document.querySelector('.quire-bench-choices').getAttribute('role'), document.querySelector('.quire-bench-choices').getAttribute('aria-label'), document.querySelector('.quire-bench-choices label').title]")).toEqual(["radiogroup", "background", "Nothing behind it"]);
        const chosen = () => tab.run<string[]>("[...document.querySelectorAll('.quire-bench-choices input:checked')].map((each) => each.value)");
        expect(await chosen()).toEqual(["clear"]);
        // a choice that is refused does not show as made; one already chosen is still told
        await tab.run("document.querySelector('input[value=\"color\"]').click()");
        await tab.run("document.querySelector('input[value=\"clear\"]').click()");
        expect(await chosen()).toEqual(["clear"]);
        // a thing held is picked up by a press and put down by the next
        await tab.run("document.querySelector('input[value=\"keep\"]').click()");
        expect(await chosen()).toEqual(["clear", "keep"]);
        await tab.run("document.querySelector('input[value=\"keep\"]').click()");
        expect(await chosen()).toEqual(["clear"]);
        await tab.run("[...document.querySelectorAll('.quire-bench-group:not(:last-child) .quire-bench-press')].forEach((each) => each.click())");
        expect(await tab.run("window.pressed")).toEqual(["color", "clear", "keep", "keep", "copy", "save"]);
        // the line under the work: what was done, and while busy what is being done
        await tab.run("window.box.say('Cut out in 2.2 s.')");
        expect(await tab.run("[document.querySelector('.quire-bench-said').textContent, document.querySelector('.quire-bench').classList.contains('busy')]")).toEqual(["Cut out in 2.2 s.", false]);
        await tab.run("window.box.busy(true, 'Cutting out')");
        expect(await tab.run("[document.querySelector('.quire-bench-working').textContent, document.querySelector('.quire-bench-working').classList.contains('shown'), document.querySelector('.quire-bench').classList.contains('busy')]")).toEqual(["Cutting out", true, true]);
        await tab.run("window.box.busy(false)");
        expect(await tab.run("[document.querySelector('.quire-bench-working').textContent, document.querySelector('.quire-bench-working').classList.contains('shown'), document.querySelector('.quire-bench').classList.contains('busy')]")).toEqual(["Cutting out", false, false]);
    } finally {
        await page.close();
    }
});

test("in Chromium, a row of small pictures is a row of dots whose words are pictures: each named for assistive tools, the one shown chosen in the accent, and the one pressed told", async () => {
    const css = await Bun.file(`${import.meta.dir}/../../styles/quire-bench.css`).text();
    const page = await corePage(
        `
        import { bench, pictured } from "${quire}/core/bench.ts";
        const box = bench("Try");
        document.querySelector("#host").append(box.root);
        const drawn = (d) => { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.innerHTML = '<path d="' + d + '"/>'; return svg; };
        window.pressed = [];
        const shapes = pictured("shape", [{ value: "square", picture: drawn("M0 0h4v4H0z"), tip: "Squares" }, { value: "dots", picture: drawn("M2 0a2 2 0 1 0 0 4a2 2 0 1 0 0-4"), tip: "Dots" }], (value) => (window.pressed.push(value), shapes.show(value)));
        shapes.show("square");
        box.side.append(shapes.group);
        window.ready = true;
    `,
        { body: `<style>${css}</style><div id="host"></div>` },
    );
    if (!page) return;
    const { tab } = page;
    try {
        for (let waited = 0; waited < 100 && !(await tab.run<boolean>("window.ready === true")); waited++) await tab.wait(100);
        expect(await tab.run("[document.querySelector('.quire-bench-heading').textContent, document.querySelector('.quire-bench-choices').className, document.querySelector('.quire-bench-choices').getAttribute('role')]")).toEqual(["shape", "quire-bench-choices quire-bench-pictured", "radiogroup"]);
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-pictured label')].map((each) => [each.title, each.querySelector('input').type, each.querySelector('input').getAttribute('aria-label'), !!each.querySelector('svg'), each.textContent])")).toEqual([
            ["Squares", "radio", "Squares", true, ""],
            ["Dots", "radio", "Dots", true, ""],
        ]);
        const chosen = () => tab.run<string[]>("[...document.querySelectorAll('.quire-bench-pictured input:checked')].map((each) => each.value)");
        expect(await chosen()).toEqual(["square"]);
        // a press on the picture itself reaches its input, and the one chosen is drawn in the accent, the other not
        const at = await tab.run<{ x: number; y: number }>("(() => { const b = document.querySelectorAll('.quire-bench-pictured label')[1].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()");
        await tab.click(at.x, at.y);
        expect(await tab.run("window.pressed")).toEqual(["dots"]);
        expect(await chosen()).toEqual(["dots"]);
        await tab.wait(300);
        const accent = await tab.run<string>("(() => { const probe = document.createElement('i'); probe.style.color = 'var(--accent)'; document.body.append(probe); return getComputedStyle(probe).color; })()");
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-pictured label')].map((each) => getComputedStyle(each).color)")).toEqual([expect.not.stringMatching(accent.replace(/[()]/g, "\\$&")), accent]);
    } finally {
        await page.close();
    }
});
