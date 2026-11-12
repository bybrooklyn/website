// The built /mdquire/ page beside the built home page: the site's name and flags sit in exactly the
// same place and size on both, so that nothing jumps when the editor opens. It reads the site as
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

if (!live) console.warn("page.test.ts: skipped, as there is no Chromium or no built site (bun run build)");
