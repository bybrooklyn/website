// What imgQuire's one side panel (side.ts) is held to: a page's name is its title in plain lowercase
// words joined by dashes; and in Chromium, one page shows at a time and the one before is told it went,
// giving the keyboard back if it had it; a page's close shows the first page again, and the first page's
// close does nothing; Escape inside it does what the tool says it does, or else goes back to the first
// page; a part that answers Escape itself keeps it; and the line over the pages grows in with its words
// and folds away.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { pageName } from "./side";

test("a page is named by its title in lowercase words joined by dashes", () => {
    expect(["export", "mark up", "version history", "Read text", " cut out "].map(pageName)).toEqual(["export", "mark-up", "version-history", "read-text", "cut-out"]);
});

test("in Chromium, one page shows at a time, Escape and close go back to the first, and the line over the pages comes and goes", async () => {
    const page = await corePage(`
        import { sideColumn } from "${quire}/img/side.ts";
        window.told = [];
        window.escaping = false;
        const back = document.createElement("button");
        back.className = "back";
        document.body.append(back);
        const side = sideColumn({ home: () => first, back: () => back.focus(), escape: () => (window.escaping ? (window.told.push("escape"), true) : false), left: (page) => window.told.push("left " + page.panel.dataset.page) });
        document.querySelector("#host").append(side.element);
        const first = side.page("export");
        const second = side.page("mark up", "", { left: () => window.told.push("second went") });
        const own = side.page("version history", "", { heading: false });
        const field = document.createElement("input");
        second.body.append(field);
        const held = document.createElement("input");
        held.dataset.ownEscape = "";
        own.body.append(held);
        first.open();
        window.side = side; window.first = first; window.second = second; window.own = own; window.field = field; window.held = held;
        window.ready = true;
    `);
    if (!page) return;
    const { tab } = page;
    try {
        for (let waited = 0; waited < 100 && !(await tab.run<boolean>("window.ready === true")); waited++) await tab.wait(100);
        const shown = () => tab.run("[document.querySelector('.quire-img-side').dataset.page, [...document.querySelectorAll('.quire-img-page')].map((each) => [each.dataset.page, each.classList.contains('open'), each.inert])]");
        expect(await shown()).toEqual(["export", [["export", true, false], ["mark-up", false, true], ["version-history", false, true]]]);
        expect(await tab.run("[...document.querySelectorAll('.quire-img-page-title')].map((each) => each.textContent)")).toEqual(["export", "mark up"]);
        // another page shows in its place; the first's close does nothing
        await tab.run("window.second.open(); window.field.focus()");
        expect((await shown() as [string])[0]).toBe("mark-up");
        expect(await tab.run("[window.first.isOpen(), window.second.isOpen()]")).toEqual([false, true]);
        await tab.run("window.first.close()");
        expect((await shown() as [string])[0]).toBe("mark-up");
        // Escape in it, with the tool saying nothing to do: back to the first, the one that went told, the keyboard given back
        await tab.press("Escape");
        expect((await shown() as [string])[0]).toBe("export");
        expect(await tab.run("window.told")).toEqual(["left export", "second went", "left mark-up"]);
        expect(await tab.run("document.activeElement.className")).toBe("back");
        // Escape answered by the tool: the page stays
        await tab.run("window.second.open(); window.field.focus(); window.escaping = true");
        await tab.press("Escape");
        expect((await shown() as [string])[0]).toBe("mark-up");
        expect(await tab.run("window.told.at(-1)")).toBe("escape");
        // a part that answers Escape itself keeps it
        await tab.run("window.escaping = false; window.own.open(); window.held.focus()");
        await tab.press("Escape");
        expect((await shown() as [string])[0]).toBe("version-history");
        await tab.run("window.own.close()");
        expect((await shown() as [string])[0]).toBe("export");
        // the line over the pages: its words and its words to press, then folded away
        await tab.run("(() => { const stop = document.createElement('button'); stop.textContent = 'stop'; window.side.say({ words: 'Repairing 40%', controls: [stop] }); })()");
        expect(await tab.run("[document.querySelector('.quire-img-doing').classList.contains('away'), document.querySelector('.quire-img-doing-said').textContent, [...document.querySelectorAll('.quire-img-doing button')].map((each) => each.textContent)]")).toEqual([false, "Repairing 40%", ["stop"]]);
        await tab.run("window.side.say(undefined)");
        expect(await tab.run("[document.querySelector('.quire-img-doing').classList.contains('away'), document.querySelector('.quire-img-doing').inert]")).toEqual([true, true]);
    } finally {
        await page.close();
    }
});

test("in Chromium, a page not shown that is taller than the shown one keeps its height while it fades, then lets the column scroll no further than the shown page's end", async () => {
    const page = await corePage(`
        import { sideColumn } from "${quire}/img/side.ts";
        const side = sideColumn({ home: () => tall, back: () => {} });
        side.element.style.height = "300px";
        document.querySelector("#host").append(side.element);
        const tall = side.page("export");
        const short = side.page("crop");
        const filler = document.createElement("div");
        filler.style.height = "1500px";
        tall.body.append(filler);
        const line = document.createElement("div");
        line.style.height = "100px";
        short.body.append(line);
        tall.open();
        window.side = side; window.tall = tall; window.short = short;
        window.ready = true;
    `);
    if (!page) return;
    const { tab } = page;
    try {
        for (let waited = 0; waited < 100 && !(await tab.run<boolean>("window.ready === true")); waited++) await tab.wait(100);
        await tab.run("window.short.open()");
        // while it fades it is as tall as it was
        expect(await tab.run<number>("document.querySelector('[data-page=export]').getBoundingClientRect().height")).toBeGreaterThan(1500);
        await tab.wait(400);
        const sizes = await tab.run<{ scroll: number; client: number }>("(() => { const column = document.querySelector('.quire-img-side'); return { scroll: column.scrollHeight, client: column.clientHeight }; })()");
        // the column had scrolled on past the short page into the gone page's 1500 pixels of nothing
        expect(sizes.scroll).toBe(sizes.client);
    } finally {
        await page.close();
    }
});
