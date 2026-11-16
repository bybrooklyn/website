// What the panel's pieces are held to, in Chromium: a row of choices has one pressed, the arrow keys
// move along it passing over a choice this browser cannot do, which a press does not take and whose
// reason is its tooltip; a fold shut cannot be reached by the keyboard; a number field brings a value
// outside its bounds inside them; and a refusal can carry an offer.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { Offered } from "./parts";

test("a refusal carries the words of its offer and the choices it makes", () => {
    const refused = new Offered("TOML needs named values at the top, and this is a list.", { label: "Put the list under the name items.", options: { wrap: "items" } });
    expect(refused.message).toBe("TOML needs named values at the top, and this is a list.");
    expect(refused.offer.options).toEqual({ wrap: "items" });
});

test("in Chromium, choices move by the arrow keys past what cannot be done, folds shut are out of reach, and numbers stay in bounds", async () => {
    const page = await corePage(`
        import { choices, fold, numberField } from "${quire}/convert/parts.ts";
        window.picked = [];
        const row = choices("Into", [{ value: "wav", label: "WAV" }, { value: "aac", label: "AAC", cannot: "This browser cannot write AAC." }, { value: "flac", label: "FLAC" }], "wav", (value) => window.picked.push(value));
        const shut = fold(document.createElement("button"));
        window.numbers = [];
        const number = numberField("Largest side", "px", 2048, { least: 16, most: 16384 }, (value) => window.numbers.push(value));
        document.querySelector("#host").append(row.element, shut.element, number.element);
        window.parts = { row, shut, number };
    `);
    if (!page) return console.warn("parts test skipped: needs a Chromium");
    try {
        const { tab } = page;
        expect(await tab.run("document.querySelector('[aria-checked=true]').textContent")).toBe("WAV");
        await tab.run("document.querySelector('[aria-checked=true]').focus()");
        await tab.press("ArrowRight");
        expect(await tab.run("window.picked")).toEqual(["flac"]);
        await tab.run("[...document.querySelectorAll('.quire-convert-choice')][1].click()");
        expect(await tab.run("window.picked")).toEqual(["flac"]);
        expect(await tab.run("[...document.querySelectorAll('.quire-convert-choice')][1].title")).toBe("This browser cannot write AAC.");
        expect(await tab.run("document.querySelector('.quire-convert-fold-in').inert")).toBe(true);
        await tab.run("window.parts.shut.open(true)");
        expect(await tab.run("document.querySelector('.quire-convert-fold-in').inert")).toBe(false);
        await tab.run("(() => { const input = document.querySelector('.quire-convert-field'); input.value = '99999'; input.dispatchEvent(new Event('change')); })()");
        expect(await tab.run("window.numbers")).toEqual([16384]);
        expect(await tab.run("document.querySelector('.quire-convert-field').value")).toBe("16384");
    } finally {
        await page.close();
    }
});
