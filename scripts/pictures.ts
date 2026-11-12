// Makes the picture each page shows when its link is shared, into src/assets/share/ (1200 by 630):
//
//   site.png           the site's own card, for every page with no other picture
//   project-<id>.png   a project with no cover: its drawn cover
//   post-<id>.png      a post with no cover: its title and date
//   mini-<id>.png      a mini, photographed while it runs
//
// `bun run pictures` makes them all with the system's Chromium; give names to make only those
// (`bun run pictures mini-dice`). `bun run pictures --check` only says which are missing, and
// `bun run check` runs that, so a new post, project or mini cannot go out with no picture.

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import { site } from "../src/data/site";
import { accents, languageColors, otherLanguageColor, theme, type Oklch } from "../src/data/theme";
import { css } from "../src/lib/color";
import { cells, nameSize } from "../src/lib/drawn";
import { browser, type Browser } from "./browser";
import { at, frontmatter, listMdx, stem } from "./lib";

const WIDTH = 1200;
const HEIGHT = 630;
const folder = at("src/assets/share");

interface Wanted {
    name: string;
    make(tab: Browser): Promise<Buffer>;
}

/** A card in the style of a drawn cover: the squares worked out from the words, and the words under them. */
function card(words: string, tint: Oklch, under?: string): Wanted["make"] {
    // 320 units across, as a drawn cover is; 168 down to fit the picture's shape.
    const size = nameSize(words);
    const squares = cells(words).map((cell) => `<rect x="${cell.x}" y="${cell.y}" width="12" height="12" rx="2.5" opacity="${cell.strength.toFixed(2)}"/>`);
    const page = `<!doctype html><meta charset="utf-8"><style>
        @font-face { font-family: Torrens; src: url("file://${at("src/assets/fonts/torrens-serif.woff2")}"); font-weight: 100 900; }
        html, body { margin: 0; background: ${css(theme.surface)}; }
        svg { display: block; width: ${WIDTH}px; height: ${HEIGHT}px; }
        .ground { fill: color-mix(in oklab, ${css(tint)} 13%, ${css(theme.surface)}); }
        .squares { fill: ${css(tint)}; }
        text { font-family: Torrens; font-weight: 520; letter-spacing: -0.01em; fill: ${css(theme.ink)}; }
        .under { fill: ${css(theme.muted)}; font-size: 8px; letter-spacing: 0; }
    </style><svg viewBox="0 0 320 168"><rect class="ground" width="320" height="168"/><g class="squares">${squares.join("")}</g>
    <text x="17" y="${under ? 138 : 148}" font-size="${size.toFixed(1)}">${escape(words)}</text>${under ? `<text class="under" x="17" y="154">${escape(under)}</text>` : ""}</svg>`;
    return async (tab) => {
        const file = at(".astro", "share-card.html");
        await Bun.write(file, page);
        await tab.open(`file://${file}`);
        await tab.run("document.fonts.ready.then(() => 1)");
        return tab.picture({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
    };
}

const escape = (text: string) => text.replace(/[&<>]/g, (sign) => `&#${sign.charCodeAt(0)};`);

/**
 * How each mini is photographed, where the plain way (the middle of it, as it starts) shows too little:
 * what to add to its address, script to run in its page, how long to wait, how much of its width to take, and from where.
 */
const shots: Record<string, { query?: string; script?: string; wait?: number; across?: number; from?: "middle" | "bottom" }> = {
    // a roll by link, photographed once the numbers have lined up
    dice: { query: "?roll=2d20%2B2d6%2Bd8%2Bd4%2B3", wait: 15000 },
    blocks: { across: 0.45, from: "bottom" },
    // part of the way through a password
    plinko: { script: `document.querySelector(".dice-go").click();`, wait: 7000 },
};

function mini(id: string): Wanted["make"] {
    return async (tab) => {
        const { query = "", script, wait = 2500, across = 1, from = "middle" } = shots[id] ?? {};
        await tab.open(`${await served()}/minis/${id}/${query}`, 1500);
        if (script) await tab.run(`${script}; 1`);
        await tab.wait(wait);
        if (tab.errors.length > 0) throw new Error(`${id}: ${tab.errors.join("; ")}`);
        const box = await tab.run<{ x: number; y: number; width: number; height: number }>(`(() => { const b = document.querySelector(".mini-stage canvas").getBoundingClientRect(); return { x: b.x + scrollX, y: b.y + scrollY, width: b.width, height: b.height }; })()`);
        // A piece of the canvas in the picture's shape.
        const height = Math.min(box.height, (box.width * across * HEIGHT) / WIDTH);
        const width = (height * WIDTH) / HEIGHT;
        const shot = await tab.picture({ x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) * (from === "bottom" ? 1 : 0.5), width, height });
        return sharp(shot).resize(WIDTH, HEIGHT).png().toBuffer();
    };
}

/** The site, running here for the minis to be photographed on. Started the first time it is asked for. */
let running: Promise<{ address: string; stop(): Promise<void> }> | undefined;
async function served(): Promise<string> {
    running ??= (async () => {
        const { dev } = await import("astro");
        const server = await dev({ root: at(), logLevel: "silent", server: { port: 4399 } });
        return { address: `http://localhost:${server.address.port}`, stop: () => server.stop() };
    })();
    return (await running).address;
}

async function wanted(): Promise<Wanted[]> {
    const read = (path: string) => Bun.file(at(path)).text();
    const list: Wanted[] = [{ name: "site", make: card(`${site.name.toLowerCase()}.`, accents.violet) }];
    for (const file of await listMdx("src/content/projects")) {
        const source = await read(`src/content/projects/${file}`);
        if (frontmatter(source, "cover")) continue;
        list.push({ name: `project-${stem(file)}`, make: card(frontmatter(source, "name")!, languageColors[frontmatter(source, "language")!] ?? otherLanguageColor) });
    }
    for (const file of await listMdx("src/content/blog")) {
        const source = await read(`src/content/blog/${file}`);
        // A post being held back has `.hold` in its name and is not part of the site.
        if (file.includes(".hold.") || frontmatter(source, "cover")) continue;
        const date = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(frontmatter(source, "date")!));
        list.push({ name: `post-${stem(file)}`, make: card(frontmatter(source, "title")!, accents[(frontmatter(source, "accent") as keyof typeof accents) ?? "violet"] ?? accents.violet, date) });
    }
    for (const file of await listMdx("src/content/minis")) list.push({ name: `mini-${stem(file)}`, make: mini(stem(file)) });
    return list;
}

const asked = process.argv.slice(2);
const all = await wanted();
const path = (name: string) => `${folder}/${name}.png`;

if (asked.includes("--check")) {
    const missing = all.filter((one) => !existsSync(path(one.name))).map((one) => one.name);
    if (missing.length > 0) {
        console.error(`No picture for sharing: ${missing.join(", ")}. Make them with: bun run pictures ${missing.join(" ")}`);
        process.exit(1);
    }
    process.exit(0);
}

await mkdir(folder, { recursive: true });
const tab = await browser({ width: 1280, height: 900, scale: 2 });
try {
    for (const one of all.filter((one) => asked.length === 0 || asked.includes(one.name))) {
        await Bun.write(path(one.name), await sharp(await one.make(tab)).resize(WIDTH, HEIGHT).png({ compressionLevel: 9 }).toBuffer());
        console.log(`made ${one.name}.png`);
    }
} finally {
    await tab.close();
    await (await running)?.stop();
}
process.exit(0);
