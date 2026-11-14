// The built /mdquire/ page beside the built home page: the site's name and flags sit in exactly the
// same place and size on both, so that nothing jumps when the editor opens; and its top is two lines
// in one piece, aligned and whole when scrolled, its tools folding in order. It reads the site as
// last built (`bun run build`) and is skipped, with a notice, when there is no build or no Chromium.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { browser, chromium, type Browser } from "../../scripts/browser";

const dist = `${import.meta.dir}/../../dist`;
const live = !!chromium() && existsSync(`${dist}/index.html`) && existsSync(`${dist}/mdquire/index.html`);
let server: ReturnType<typeof Bun.serve> | undefined;
let tab: Browser;

beforeAll(async () => {
    if (!live) return;
    server = Bun.serve({
        port: 0,
        async fetch(request) {
            let path = new URL(request.url).pathname;
            if (path.endsWith("/")) path += "index.html";
            const file = Bun.file(dist + path);
            return (await file.exists()) ? new Response(file) : new Response("missing", { status: 404 });
        },
    });
    tab = await browser({ width: 1440, height: 900 });
}, 60_000);

afterAll(async () => {
    await tab?.close();
    server?.stop();
});

/** A flag's label, shown as hovering shows it: where it sits from its flag, how it looks, and whether anything covers it. */
const label = () =>
    tab.run<Record<string, unknown>>(`(() => { const flag = document.querySelector('.flag.lesbian'); const tip = flag.querySelector('.tip'); tip.style.transition = 'none'; tip.style.opacity = '1'; tip.style.visibility = 'visible'; const style = getComputedStyle(tip); const a = flag.getBoundingClientRect(), b = tip.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { dx: Math.round(b.left - a.left), dy: Math.round(b.top - a.top), width: Math.round(b.width), size: style.fontSize, color: style.color, ground: style.backgroundColor, font: style.fontFamily, seen: tip.contains(hit) }; })()`);

/** The boxes of the site's name and its two flags, rounded to the pixel. */
const boxes = () =>
    tab.run<number[][]>(`[...document.querySelectorAll('.site-id .site-name, .site-id .flag')].map((element) => { const box = element.getBoundingClientRect(); return [box.left, box.top, box.width, box.height].map(Math.round); })`);

test.skipIf(!live)(
    "the site's name and flags are where the home page has them, to the pixel, at 1440 and 2560 wide, and their labels are the same",
    async () => {
        for (const [wide, high] of [[1440, 900], [2560, 1300]] as const) {
            await tab.resize(wide, high);
            await tab.open(`http://localhost:${server!.port}/`, 600);
            const home = await boxes();
            const homeLabel = await label();
            await tab.open(`http://localhost:${server!.port}/mdquire/`, 800);
            const editor = await boxes();
            expect(home.length).toBe(3);
            expect({ wide, editor }).toEqual({ wide, editor: home });
            // the flags' labels are the site's own, the same as on the home page
            expect({ wide, label: await label() }).toEqual({ wide, label: homeLabel });
        }
    },
    60_000,
);

/** Opens the editor on a blank page from the home screen, at a size. */
async function blank(wide: number, high: number) {
    await tab.resize(wide, high);
    await tab.open(`http://localhost:${server!.port}/mdquire/`, 800);
    await tab.run("document.querySelector('.quire-shelf.shown .quire-shelf-word')?.click()");
    await tab.wait(1200);
}

/** Where the top's parts are: the middle of each on the first line, and where each line's first and last drawn thing starts and ends. */
const top = () =>
    tab.run<{ middles: Record<string, number>; first: [number, number]; second: [number, number]; height: number; folded: string[]; over: number; page: number }>(`(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const middle = (selector) => { const b = box(selector); return (b.top + b.bottom) / 2; };
        const marks = [...document.querySelectorAll('.quire-bar-strip .quire-icon, .quire-bar-strip .quire-glyph')].filter((each) => each.getBoundingClientRect().width > 0 && !each.closest('.folded, .away'));
        const strip = document.querySelector('.quire-bar-strip');
        return {
            middles: Object.fromEntries(['.site-name', '.quire-word', '.quire-name-text', '.quire-row-word', '.quire-status-line'].map((selector) => [selector, middle(selector)])),
            first: [box('.site-name').left, box('.quire-status-line').right],
            second: [marks[0].getBoundingClientRect().left, marks.at(-1).getBoundingClientRect().right],
            height: box('.quire-top').height,
            folded: [...document.querySelectorAll('.quire-tool.folded')].map((tool) => tool.firstElementChild.getAttribute('aria-label') ?? tool.firstElementChild.className),
            over: strip.scrollWidth - strip.clientWidth,
            page: document.documentElement.scrollWidth - innerWidth,
        };
    })()`);

test.skipIf(!live)(
    "the top is two lines in one piece: the first centred on one middle, both lines on the same left and right edges, and on scrolling it is whole and the same height",
    async () => {
        for (const [wide, high] of [[2560, 1300], [1765, 1000], [1300, 900], [1024, 768]] as const) {
            await blank(wide, high);
            const at = await top();
            const name = at.middles[".site-name"]!;
            for (const [part, middle] of Object.entries(at.middles)) expect({ wide, part, middle: Math.abs(middle - name) <= 1 }).toEqual({ wide, part, middle: true });
            // the tools' first icon starts where her name starts, and their last ends where the status ends, within the icons' own margin
            expect({ wide, left: Math.abs(at.second[0] - at.first[0]) <= 3, right: Math.abs(at.second[1] - at.first[1]) <= 8 }).toEqual({ wide, left: true, right: true });
            expect({ wide, over: at.over, page: at.page <= 0 }).toEqual({ wide, over: 0, page: true });
            const stuck = await tab.run<{ height: number; top: number }>(`(async () => { document.querySelector('.quire-paper').style.minHeight = '6000px'; scrollTo({ top: 3000, behavior: 'instant' }); await new Promise((done) => setTimeout(done, 300)); const top = document.querySelector('.quire-top').getBoundingClientRect(); return { height: top.height, top: top.top }; })()`);
            expect({ wide, height: Math.round(stuck.height), top: stuck.top }).toEqual({ wide, height: Math.round(at.height), top: 0 });
        }
    },
    120_000,
);

test.skipIf(!live)(
    "the tools fold into the three dots least used first, paint format before print before clear formatting, and down to a small window what a writer needs most never",
    async () => {
        const order = ["Paint format", "Print", "Clear formatting", "Indent less", "Line spacing", "Zoom"];
        let before = -1;
        for (const [wide, high] of [[2560, 1300], [1765, 1000], [1300, 900], [1024, 768]] as const) {
            await blank(wide, high);
            const at = await top();
            const folded = at.folded.map((label) => label.replace(/[:(].*/, "").trim());
            // what has folded is a run from the start of the order, never one later before one sooner
            const seen = order.map((label) => folded.some((each) => each.startsWith(label) || (label === "Indent less" && each.includes("quire-tool-set"))));
            expect({ wide, ordered: seen.every((on, index) => on || !seen.slice(index + 1).some(Boolean)) }).toEqual({ wide, ordered: true });
            expect({ wide, kept: folded.filter((label) => /^(Undo|Style|Bold|Italic|Link|Picture|quire-grow)$/.test(label)) }).toEqual({ wide, kept: [] });
            // below the widths where the page's type still grows with the window, narrower means no fewer fold
            if (wide <= 1300) expect(at.folded.length).toBeGreaterThanOrEqual(before);
            before = at.folded.length;
        }
    },
    120_000,
);

if (!live) console.warn("page.test.ts: skipped, as there is no Chromium or no built site (bun run build)");
