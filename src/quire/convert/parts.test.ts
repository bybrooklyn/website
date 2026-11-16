// What the column's pieces are held to, in Chromium: a row of choices is the kit's round dots under a
// small label, one chosen; the arrow keys move along it passing over a choice this browser cannot do,
// which a press does not take, which is drawn faint, and whose reason is shown when the pointer rests on
// it, and which can be taken again once it can be done; a fold shut cannot be reached by the keyboard; a
// number to type brings a value outside its bounds inside them and says its unit; a note with nothing to
// say has shrunk away; and a refusal can carry an offer.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { Offered } from "./parts";

test("a refusal carries the words of its offer and the choices it makes", () => {
    const refused = new Offered("TOML needs named values at the top, and this is a list.", { label: "Put the list under the name items.", options: { wrap: "items" } });
    expect(refused.message).toBe("TOML needs named values at the top, and this is a list.");
    expect(refused.offer.options).toEqual({ wrap: "items" });
});

test("in Chromium, choices are the kit's dots, move by the arrow keys past what cannot be done, folds shut are out of reach, and numbers stay in bounds", async () => {
    const page = await corePage(`
        import { choices, fold, note, numberField } from "${quire}/convert/parts.ts";
        window.picked = [];
        const options = (aac) => [{ value: "wav", label: "wav" }, { value: "aac", label: "aac", cannot: aac ? undefined : "This browser cannot write AAC." }, { value: "flac", label: "flac", tip: "Every sample kept" }];
        const row = choices("into", options(false), "wav", (value) => window.picked.push(value));
        const shut = fold(document.createElement("button"));
        window.numbers = [];
        const number = numberField("largest side", "px", 2048, { least: 16, most: 16384 }, (value) => window.numbers.push(value));
        const quiet = note();
        document.querySelector("#host").append(row.element, shut.element, number.element, quiet);
        window.parts = { row, shut, number, options };
        window.ready = true;
    `);
    if (!page) return console.warn("parts test skipped: needs a Chromium");
    try {
        const { tab } = page;
        for (let waited = 0; waited < 100 && !(await tab.run<boolean>("window.ready === true")); waited++) await tab.wait(100);
        const labels = "[...document.querySelectorAll('.quire-bench-choices label')]";
        expect(await tab.run("[document.querySelector('.quire-bench-row').className, document.querySelector('.quire-bench-label').textContent]")).toEqual(["quire-bench-row wide", "into"]);
        expect(await tab.run(`${labels}.map((each) => each.textContent)`)).toEqual(["wav", "aac", "flac"]);
        expect(await tab.run("document.querySelector('input:checked').value")).toBe("wav");
        await tab.run("document.querySelector('input:checked').focus()");
        await tab.press("ArrowRight");
        expect(await tab.run("window.picked")).toEqual(["flac"]);
        expect(await tab.run("document.querySelector('input:checked').value")).toBe("flac");
        await tab.run(`${labels}[1].click()`);
        expect(await tab.run("window.picked")).toEqual(["flac"]);
        expect(await tab.run(`[${labels}[1].title, ${labels}[1].classList.contains('cannot'), ${labels}[2].title]`)).toEqual(["This browser cannot write AAC.", true, "Every sample kept"]);
        await tab.run("window.parts.row.bar(window.parts.options(true))");
        await tab.run(`${labels}[1].click()`);
        expect(await tab.run("window.picked")).toEqual(["flac", "aac"]);
        expect(await tab.run(`[${labels}[1].hasAttribute('title'), ${labels}[1].classList.contains('cannot')]`)).toEqual([false, false]);
        expect(await tab.run("document.querySelector('.quire-convert-fold-in').inert")).toBe(true);
        await tab.run("window.parts.shut.open(true)");
        expect(await tab.run("document.querySelector('.quire-convert-fold-in').inert")).toBe(false);
        await tab.run("(() => { const input = document.querySelector('input[type=number]'); input.value = '99999'; input.dispatchEvent(new Event('change')); })()");
        expect(await tab.run("window.numbers")).toEqual([16384]);
        expect(await tab.run("document.querySelector('input[type=number]').value")).toBe("16384");
        expect(await tab.run("document.querySelector('.quire-convert-unit').textContent")).toBe("px");
        expect(await tab.run("document.querySelector('.quire-convert-note').classList.contains('empty')")).toBe(true);
    } finally {
        await page.close();
    }
});
