// What the look is held to. In Bun: the shapes' paths, the eyes', the middle picture's square centered and
// the error correction raised exactly as far as every block needs, a flag's light stripes deepened, the
// halftone keeping each module's middle its own color. In Chromium: every family of style (each shape,
// each eye, each paint, a clear and a dark ground, a picture in the middle, a picture as the code in color
// and as a halftone) drawn small (4 pixels a module) and large (12), turned into pixels by the browser
// as the page does, and read back by this reader; and each of those pictures read by zbarimg too, where
// it is installed, as a second reader that owes this code nothing (light on dark with its inverted test
// switched on; the halftone from 6 pixels a module, as at 4 its thirds are under two pixels).

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corePage, quire } from "../../../scripts/core-page";
import { contrast } from "./colors";
import { encode } from "./encode";
import { blockOfEach, codeFor, damage, deepenedAny, drawSvg, eyesPath, halftone, inkColors, middleFits, middleSquare, modulesPath, PLAIN, type Look } from "./style";
import { blocksOf } from "./tables";

test("squares are drawn as runs, one rectangle for each run of dark modules in a row", () => {
    const code = encode("runs", { level: "L" });
    const path = modulesPath(code, "square");
    let runs = 0;
    for (let y = 0; y < code.side; y++) {
        for (let x = 0; x < code.side; x++) {
            const part = code.parts[y * code.side + x];
            const drawn = (at: number) => at < code.side && code.modules[y * code.side + at] === 1 && code.parts[y * code.side + at] !== 1 && code.parts[y * code.side + at] !== 2;
            if (drawn(x) && !(x > 0 && drawn(x - 1))) runs++;
            void part;
        }
    }
    expect(path.split("M").length - 1).toBe(runs);
    // every other shape draws something for each dark module, and the eyes are three rings and three middles
    for (const shape of ["rounded", "dots", "diamonds", "bars", "joined"] as const) expect(modulesPath(code, shape).length).toBeGreaterThan(100);
    expect(eyesPath(code.side, "round").split("M").length - 1).toBe(9);
});

test("the middle picture's square is centered on whole modules", () => {
    expect(middleSquare(25, 0.2)).toEqual({ from: 10, width: 5 });
    expect(middleSquare(29, 0.25)).toEqual({ from: 11, width: 7 });
    for (let side = 21; side <= 177; side += 4) for (const share of [0.12, 0.2, 0.32]) {
        const { from, width } = middleSquare(side, share);
        expect(from * 2 + width).toBe(side);
    }
});

test("each byte's block is the one the maker put it in, and the damage of a covered square is counted by block", () => {
    const layout = blocksOf(5, "Q");
    const blocks = blockOfEach(5, "Q");
    expect(blocks.length).toBe(layout.total);
    // the first bytes go one to each block in turn
    expect([...blocks.slice(0, 4)]).toEqual([0, 1, 2, 3]);
    const code = encode("count the damage", { level: "Q", minVersion: 5, raise: false });
    expect(damage(code, () => false)).toEqual([0, 0, 0, 0]);
    expect(damage(code, () => true)).toEqual([33, 33, 34, 34]);
});

test("a middle picture raises the level as far as every block needs, keeping the code as small as it can be, and a picture too big is said so", () => {
    const text = "https://example.com/menu";
    const levels = ["L", "M", "Q", "H"] as const;
    const withPicture = codeFor(text, { level: "L", middle: 0.22 });
    expect(withPicture.problem).toBeUndefined();
    const chosen = withPicture.code!;
    expect(middleFits(chosen, 0.22)).toBe(true);
    // no smaller code, at any level, would have mended what the picture covers
    for (const level of levels) {
        const smaller = encode(text, { level, raise: false });
        if (smaller.version < chosen.version) expect(middleFits(smaller, 0.22)).toBe(false);
    }
    // and at its size it has the most mending that fits
    expect(chosen.level).toBe(encode(text, { level: "L", minVersion: chosen.version }).level);
    expect(codeFor(text, { level: "L", middle: 0.5 }).problem).toBe("picture");
    expect(codeFor("a".repeat(3000), { level: "L" }).problem).toBe("long");
    // a picture as the code is given the most mending that fits
    expect(codeFor(text, { level: "L", through: true }).code!.level).toBe("H");
});

test("a flag's stripes too light for the ground are deepened, and the halftone keeps each module's middle its own", () => {
    for (const flag of ["trans", "nonbinary", "pansexual"]) {
        expect(deepenedAny({ kind: "flag", flag }, "#ffffff")).toBe(true);
        for (const color of inkColors({ kind: "flag", flag }, "#ffffff")) expect(contrast(color, "#ffffff")).toBeGreaterThanOrEqual(3.5);
    }
    const code = encode("halftone", { level: "H" });
    const grid = code.side * 3;
    // a picture of a gradient, light at the left and dark at the right
    const light = Uint8Array.from({ length: grid * grid }, (_, i) => 255 - Math.round(((i % grid) / grid) * 255));
    const dark = halftone(code, light);
    for (let y = 0; y < code.side; y++) for (let x = 0; x < code.side; x++) expect(dark[(y * 3 + 1) * grid + x * 3 + 1]).toBe(code.modules[y * code.side + x]!);
    // the picture shows: more dark thirds at the right than at the left
    let left = 0;
    let right = 0;
    for (let i = 0; i < dark.length; i++) (i % grid < grid / 2 ? (left += dark[i]!) : (right += dark[i]!));
    expect(right).toBeGreaterThan(left * 1.2);
});

test("the SVG is one well-formed picture, sized as asked, its viewBox in modules from the margin's corner", () => {
    const code = encode("svg", { level: "M" });
    const svg = drawSvg(code, { ...PLAIN, margin: 2 }, { size: 300, title: 'a "title" <here>' });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 25 25" width="300" height="300">')).toBe(true);
    expect(svg).toContain("<title>a &quot;title&quot; &lt;here></title>");
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(drawSvg(code, { ...PLAIN, ground: undefined })).not.toContain("<rect");
});

/** Every family of style, by name. */
const FAMILIES: Record<string, Partial<Look> & { level?: "L" | "M" | "Q" | "H"; picture?: "middle" | "colored" | "halftone"; share?: number }> = {
    "squares, square eyes, black on white": {},
    "rounded squares, rounded eyes": { shape: "rounded", eyes: "rounded" },
    "dots, round eyes": { shape: "dots", eyes: "round" },
    "diamonds, square eyes": { shape: "diamonds" },
    "bars, rounded eyes": { shape: "bars", eyes: "rounded" },
    "joined, round eyes": { shape: "joined", eyes: "round" },
    "joined, square eyes, violet": { shape: "joined", ink: { kind: "solid", color: "#5b2a86" } },
    "a gradient, blue to pink": { shape: "rounded", ink: { kind: "gradient", from: "#1d3fbf", to: "#b5176f", angle: 30 } },
    "a rainbow": { shape: "dots", eyes: "round", ink: { kind: "rainbow" } },
    "the rainbow flag": { ink: { kind: "flag", flag: "rainbow" } },
    "the trans flag, deepened": { shape: "joined", ink: { kind: "flag", flag: "trans" } },
    "the lesbian flag": { shape: "rounded", eyes: "rounded", ink: { kind: "flag", flag: "lesbian" } },
    "the bisexual flag": { shape: "dots", ink: { kind: "flag", flag: "bisexual" } },
    "the pansexual flag, deepened": { shape: "bars", ink: { kind: "flag", flag: "pansexual" } },
    "the nonbinary flag, deepened": { shape: "diamonds", eyes: "round", ink: { kind: "flag", flag: "nonbinary" } },
    "a colored ground": { ink: { kind: "solid", color: "#14213d" }, ground: "#fca311" },
    "a clear ground": { shape: "joined", ground: undefined },
    "light on dark": { shape: "dots", eyes: "round", ink: { kind: "solid", color: "#f4f0ff" }, ground: "#1b1530" },
    "a rainbow on dark": { shape: "joined", ink: { kind: "rainbow" }, ground: "#120d1f" },
    "no margin but one module": { margin: 1 },
    "a picture in the middle, a fifth of the side": { picture: "middle", share: 0.2 },
    "a picture in the middle, the largest, joined": { picture: "middle", share: 0.32, shape: "joined", eyes: "rounded" },
    "a picture as the code, in color": { picture: "colored" },
    "a picture as the code, in color, dots": { picture: "colored", shape: "dots" },
    "a picture as the code, a halftone": { picture: "halftone" },
    "a picture as the code, a halftone in violet": { picture: "halftone", ink: { kind: "solid", color: "#3a1a66" } },
};

test("every family of style, drawn small and large and turned into pixels by the browser, is read back here and by zbarimg", async () => {
    const page = await corePage(`
        import { codeFor, drawSvg, PLAIN } from "${quire}/qr/style.ts";
        import { readCodes } from "${quire}/qr/read.ts";
        // a picture made here, in code: a sky, a sun and two hills, with the colors of a photograph
        const scene = document.createElement("canvas");
        scene.width = 480; scene.height = 360;
        const c = scene.getContext("2d");
        const sky = c.createLinearGradient(0, 0, 0, 360); sky.addColorStop(0, "#2b5fa8"); sky.addColorStop(1, "#f2c48d");
        c.fillStyle = sky; c.fillRect(0, 0, 480, 360);
        c.fillStyle = "#ffe066"; c.beginPath(); c.arc(330, 120, 55, 0, 7); c.fill();
        c.fillStyle = "#2f6b3a"; c.beginPath(); c.ellipse(120, 360, 260, 140, 0, 0, 7); c.fill();
        c.fillStyle = "#1d3f25"; c.beginPath(); c.ellipse(420, 380, 220, 120, 0, 0, 7); c.fill();
        const href = scene.toDataURL("image/png");
        const lightOf = (side) => {
            const grid = side * 3, canvas = document.createElement("canvas");
            canvas.width = canvas.height = grid;
            const g = canvas.getContext("2d");
            const s = Math.min(480, 360);
            g.drawImage(scene, (480 - s) / 2, (360 - s) / 2, s, s, 0, 0, grid, grid);
            const d = g.getImageData(0, 0, grid, grid).data, out = new Uint8Array(grid * grid);
            for (let i = 0; i < out.length; i++) out[i] = Math.round(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
            return out;
        };
        window.drawn = async (family, perModule) => {
            const { level = "M", picture, share = 0.2, ...rest } = family;
            const text = "https://example.com/qr?from=quire";
            const made = codeFor(text, { level, middle: picture === "middle" ? share : undefined, through: picture === "colored" || picture === "halftone" });
            const code = made.code;
            const look = { ...PLAIN, ...rest };
            if (picture === "middle") look.middle = { href, width: 480, height: 360, size: share };
            if (picture === "colored" || picture === "halftone") look.through = { href, light: lightOf(code.side), colored: picture === "colored" };
            const size = (code.side + 2 * look.margin) * perModule;
            const svg = drawSvg(code, look, { size });
            const image = new Image();
            image.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = size;
            const g = canvas.getContext("2d");
            // a clear ground is laid on white, as it would be printed or shown on a page
            g.fillStyle = "#ffffff"; g.fillRect(0, 0, size, size);
            g.drawImage(image, 0, 0, size, size);
            const pixels = g.getImageData(0, 0, size, size);
            const found = readCodes(pixels);
            return { text, read: found.map((each) => each.text), level: code.level, version: code.version, problem: made.problem ?? null, png: canvas.toDataURL("image/png").split(",")[1] };
        };
    `);
    if (!page) return;
    const folder = await mkdtemp(join(tmpdir(), "quire-qr-styles-"));
    const zbar = Bun.spawnSync(["which", "zbarimg"]).success;
    const results: string[] = [];
    const missedHere: string[] = [];
    const missedByZbar: string[] = [];
    try {
        for (const [name, family] of Object.entries(FAMILIES)) {
            // zbarimg reads a halftone from 6 pixels a module, not at 4, where its thirds are under two pixels each
            const halftone = family.picture === "halftone";
            for (const perModule of halftone ? [4, 6, 12] : [4, 12]) {
                const seen = await page.tab.run<{ text: string; read: string[]; level: string; version: number; problem: string | null; png: string }>(`window.drawn(${JSON.stringify(family)}, ${perModule})`);
                expect([name, perModule, seen.problem]).toEqual([name, perModule, null]);
                if (seen.read.join() !== seen.text) missedHere.push(`${name} at ${perModule}`);
                let theirs = "not installed";
                if (zbar && !(halftone && perModule < 6)) {
                    const path = `${folder}/${results.length}.png`;
                    await Bun.write(path, Buffer.from(seen.png, "base64"));
                    theirs = new TextDecoder().decode(Bun.spawnSync(["zbarimg", "--raw", "-q", "-Sbinary", "--set", "test-inverted", path]).stdout).replace(/\n$/, "");
                    if (theirs !== seen.text) missedByZbar.push(`${name} at ${perModule}`);
                }
                results.push(`${name} at ${perModule} px a module: version ${seen.version}-${seen.level}`);
            }
        }
    } finally {
        await page.close();
        await rm(folder, { recursive: true, force: true });
    }
    expect(results.length).toBe(Object.keys(FAMILIES).length * 2 + Object.values(FAMILIES).filter((each) => each.picture === "halftone").length);
    expect(missedHere).toEqual([]);
    expect(missedByZbar).toEqual([]);
}, 240_000);
