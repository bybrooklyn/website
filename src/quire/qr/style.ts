// How a code looks, drawn as one SVG that the page shows, saves and turns into a PNG, so what is seen is
// what is saved. Modules come in six shapes: squares (runs joined into one path, no seams), rounded
// squares, dots, diamonds, bars (a column's runs as one rounded bar) and joined (each module's outer
// corners rounded where it has no neighbor, and the inner corners between neighbors filled with a curve,
// so they flow together). The three finders, the eyes, are drawn whole as square, rounded or round. The
// dark takes a color, a gradient at an angle, a rainbow at one lightness, or a pride flag's stripes
// (stripes too light for the ground are deepened so it is still read). The ground is a color or clear,
// with a quiet margin of whole modules. A picture can sit in the middle: the modules under it are left
// out, and the level of error correction is raised until every block can mend what it covers
// (`codeFor`). Or a picture can be the code: shown in color behind small modules, or as a halftone in the
// two colors, each module's middle third kept its true color, the patterns drawn whole.
//
//   const code = codeFor(text, { level: "M" }).code;
//   svg.outerHTML = drawSvg(code, look, { size: 512 });

import { contrast, deepened, FLAGS, luminance, rainbow, scanWord } from "./colors";
import { dataOrder, encode, PART, TooLong, type Code } from "./encode";
import { blocksOf, LEVELS, type Level } from "./tables";

/** The shapes a module can be drawn as. */
export type Shape = "square" | "rounded" | "dots" | "diamonds" | "bars" | "joined";

/** The shapes the three finders can be drawn as. */
export type EyeShape = "square" | "rounded" | "round";

/** What the dark modules are painted with. */
export type Paint = { kind: "solid"; color: string } | { kind: "gradient"; from: string; to: string; angle: number } | { kind: "rainbow" } | { kind: "flag"; flag: string };

/** A picture in the middle of the code: its address (a data URL), its size in pixels, and its width as a share of the code's side. */
export interface Middle {
    href: string;
    width: number;
    height: number;
    size: number;
}

/** A picture made into the code: its address, for the colored kind, and its lightness at three samples a module across and down (0 black, 255 white), for the halftone. */
export interface Through {
    href: string;
    light: Uint8Array;
    colored: boolean;
}

/** Everything about how a code looks. */
export interface Look {
    shape: Shape;
    eyes: EyeShape;
    ink: Paint;
    /** The ground's color, or undefined for clear. */
    ground: string | undefined;
    /** The quiet margin, in modules. */
    margin: number;
    middle?: Middle;
    through?: Through;
}

/** The look a code has before anything is chosen. */
export const PLAIN: Look = { shape: "square", eyes: "square", ink: { kind: "solid", color: "#000000" }, ground: "#ffffff", margin: 4 };

/** The middle picture's least and greatest width, as a share of the code's side, and the step it snaps to. */
export const MIDDLE_SIZES = { least: 0.12, most: 0.32, step: 0.02 };

/** The ground left about a middle picture, inside the square of modules it covers, in modules. */
export const MIDDLE_INSET = 0.5;

/** A number written short for a path: at most three decimals, no trailing zeros. */
const n = (value: number): string => String(Math.round(value * 1000) / 1000);

/** The colors the dark modules take: a flag's stripes and the rainbow's colors deepened where they stand too close to the ground. */
export function inkColors(paint: Paint, ground: string | undefined): string[] {
    const behind = ground ?? "#ffffff";
    if (paint.kind === "solid") return [paint.color];
    if (paint.kind === "gradient") return [paint.from, paint.to];
    if (paint.kind === "rainbow") return rainbow(7, luminance(behind) < 0.18 ? 0.78 : 0.5).map((each) => deepened(each, behind));
    const flag = FLAGS.find((each) => each.name === paint.flag) ?? FLAGS[0]!;
    return flag.stripes.map((each) => deepened(each, behind));
}

/** True when a paint's colors had to be deepened to be read on this ground: the plain word the page gives. */
export function deepenedAny(paint: Paint, ground: string | undefined): boolean {
    if (paint.kind !== "flag") return false;
    const flag = FLAGS.find((each) => each.name === paint.flag) ?? FLAGS[0]!;
    const behind = ground ?? "#ffffff";
    return flag.stripes.some((each) => contrast(each, behind) < 3.5);
}

/** What the look's colors say about being read, a plain sentence, or nothing when they are fine. */
export const lookWord = (look: Look): string | undefined => scanWord(inkColors(look.ink, look.ground), look.ground);

/** Which block each of a code's bytes belongs to, in the order they are laid. */
export function blockOfEach(version: number, level: Level): Uint16Array {
    const { count, check, short, shortCount, total } = blocksOf(version, level);
    const out = new Uint16Array(total);
    let at = 0;
    for (let i = 0; i <= short; i++) for (let block = 0; block < count; block++) if (i < short + (block < shortCount ? 0 : 1)) out[at++] = block;
    for (let i = 0; i < check; i++) for (let block = 0; block < count; block++) out[at++] = block;
    return out;
}

/** The square of modules a middle picture of this share covers: its first module and its width, centered. */
export function middleSquare(side: number, share: number): { from: number; width: number } {
    let width = Math.round(side * share);
    if ((side - width) % 2) width++;
    return { from: (side - width) / 2, width };
}

/** For each block of a code, how many of its bytes have a module where `covered` is true. */
export function damage(code: Code, covered: (x: number, y: number) => boolean): number[] {
    const order = dataOrder(code.side, code.parts);
    const blocks = blockOfEach(code.version, code.level);
    const { count } = blocksOf(code.version, code.level);
    const hit = new Set<number>();
    for (let i = 0; i < blocks.length * 8; i++) {
        const place = order[i]!;
        const x = place % code.side;
        if (covered(x, (place - x) / code.side)) hit.add(i >>> 3);
    }
    const out = new Array<number>(count).fill(0);
    for (const byte of hit) out[blocks[byte]!]!++;
    return out;
}

/** True when every block can mend the bytes a middle picture of this share covers, keeping a byte or two to spare for misreadings. */
export function middleFits(code: Code, share: number): boolean {
    const { from, width } = middleSquare(code.side, share);
    const { check } = blocksOf(code.version, code.level);
    const most = Math.floor(check / 2) - (check >= 20 ? 2 : 1);
    return damage(code, (x, y) => x >= from && x < from + width && y >= from && y < from + width).every((each) => each <= most);
}

/** A code for a text: the smallest at the level asked, raised as far as a middle picture needs, or to the highest that keeps its size when a picture is the code. */
export function codeFor(text: string, options: { level: Level; middle?: number; through?: boolean }): { code?: Code; problem?: "long" | "picture" } {
    let first: Code;
    try {
        first = encode(text, { level: options.level });
    } catch (error) {
        if (error instanceof TooLong) return { problem: "long" };
        throw error;
    }
    if (options.middle) {
        for (const level of LEVELS.slice(LEVELS.indexOf(options.level))) {
            let code: Code;
            try {
                code = encode(text, { level });
            } catch {
                break;
            }
            if (middleFits(code, options.middle)) return { code };
        }
        return { code: first, problem: "picture" };
    }
    if (options.through) {
        // a picture through the code is read at the modules' middles alone, so it is given the most mending that fits
        for (const level of ["H", "Q", "M"] as Level[]) {
            if (LEVELS.indexOf(level) < LEVELS.indexOf(options.level)) break;
            try {
                return { code: encode(text, { level }) };
            } catch {
                // too long at this level: one lower
            }
        }
    }
    return { code: first };
}

/** The dark of a module, with nothing outside the code. */
const darkAt = (code: Code, x: number, y: number): boolean => x >= 0 && y >= 0 && x < code.side && y < code.side && code.modules[y * code.side + x] === 1;

/** True for a module of a finder or the light ring about it, which the eyes draw. */
const inEye = (code: Code, x: number, y: number): boolean => {
    const part = code.parts[y * code.side + x];
    return part === PART.finder || part === PART.separator;
};

/** The path of a rectangle, from its top left. */
const rect = (x: number, y: number, w: number, h: number) => `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;

/** The path of a rectangle with round corners of one radius. */
const roundRect = (x: number, y: number, w: number, h: number, r: number) =>
    r <= 0 ? rect(x, y, w, h) : `M${n(x + r)} ${n(y)}h${n(w - 2 * r)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(r)}v${n(h - 2 * r)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(r)}h${n(2 * r - w)}a${n(r)} ${n(r)} 0 0 1 ${n(-r)} ${n(-r)}v${n(2 * r - h)}a${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-r)}z`;

/** The path of a circle. */
const circle = (cx: number, cy: number, r: number) => `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0z`;

/** One joined module: a square whose corners are rounded where neither neighbor beside that corner is dark. */
function joinedModule(code: Code, x: number, y: number): string {
    const up = darkAt(code, x, y - 1) && !inEye(code, x, y - 1);
    const down = darkAt(code, x, y + 1) && !inEye(code, x, y + 1);
    const left = darkAt(code, x - 1, y) && !inEye(code, x - 1, y);
    const right = darkAt(code, x + 1, y) && !inEye(code, x + 1, y);
    const r = 0.5;
    const tl = !up && !left ? r : 0;
    const tr = !up && !right ? r : 0;
    const br = !down && !right ? r : 0;
    const bl = !down && !left ? r : 0;
    let d = `M${n(x + tl)} ${y}H${n(x + 1 - tr)}`;
    if (tr) d += `A${r} ${r} 0 0 1 ${x + 1} ${n(y + tr)}`;
    d += `V${n(y + 1 - br)}`;
    if (br) d += `A${r} ${r} 0 0 1 ${n(x + 1 - br)} ${y + 1}`;
    d += `H${n(x + bl)}`;
    if (bl) d += `A${r} ${r} 0 0 1 ${x} ${n(y + 1 - bl)}`;
    d += `V${n(y + tl)}`;
    if (tl) d += `A${r} ${r} 0 0 1 ${n(x + tl)} ${y}`;
    return `${d}z`;
}

/** The inner curves of a light module whose two neighbors and the one between them about a corner are dark, so an L of modules flows round its inside corner. */
function joinedFillets(code: Code, x: number, y: number): string {
    const dark = (dx: number, dy: number) => darkAt(code, x + dx, y + dy) && !inEye(code, x + dx, y + dy);
    const r = 0.5;
    let d = "";
    if (dark(-1, 0) && dark(0, -1) && dark(-1, -1)) d += `M${x} ${y}h${r}A${r} ${r} 0 0 0 ${x} ${n(y + r)}z`;
    if (dark(1, 0) && dark(0, -1) && dark(1, -1)) d += `M${x + 1} ${y}v${r}A${r} ${r} 0 0 0 ${n(x + 1 - r)} ${y}z`;
    if (dark(1, 0) && dark(0, 1) && dark(1, 1)) d += `M${x + 1} ${y + 1}h${-r}A${r} ${r} 0 0 0 ${x + 1} ${n(y + 1 - r)}z`;
    if (dark(-1, 0) && dark(0, 1) && dark(-1, 1)) d += `M${x} ${y + 1}v${-r}A${r} ${r} 0 0 0 ${n(x + r)} ${y + 1}z`;
    return d;
}

/** The path of every dark module but the eyes', in a shape, leaving out those `skip` says. */
export function modulesPath(code: Code, shape: Shape, skip: (x: number, y: number) => boolean = () => false): string {
    const parts: string[] = [];
    const { side } = code;
    const drawn = (x: number, y: number) => darkAt(code, x, y) && !inEye(code, x, y) && !skip(x, y);
    if (shape === "square") {
        for (let y = 0; y < side; y++) {
            for (let x = 0; x < side; ) {
                if (!drawn(x, y)) {
                    x++;
                    continue;
                }
                let end = x;
                while (end < side && drawn(end, y)) end++;
                parts.push(`M${x} ${y}h${end - x}v1h${x - end}z`);
                x = end;
            }
        }
    } else if (shape === "bars") {
        for (let x = 0; x < side; x++) {
            for (let y = 0; y < side; ) {
                if (!drawn(x, y)) {
                    y++;
                    continue;
                }
                let end = y;
                while (end < side && drawn(x, end)) end++;
                parts.push(roundRect(x + 0.1, y + 0.05, 0.8, end - y - 0.1, 0.4));
                y = end;
            }
        }
    } else {
        for (let y = 0; y < side; y++) {
            for (let x = 0; x < side; x++) {
                if (shape === "joined" && !drawn(x, y)) {
                    if (!inEye(code, x, y) && !skip(x, y)) parts.push(joinedFillets(code, x, y));
                    continue;
                }
                if (!drawn(x, y)) continue;
                if (shape === "rounded") parts.push(roundRect(x + 0.04, y + 0.04, 0.92, 0.92, 0.3));
                else if (shape === "dots") parts.push(circle(x + 0.5, y + 0.5, 0.44));
                else if (shape === "diamonds") parts.push(`M${n(x + 0.5)} ${n(y - 0.04)}l0.54 0.54l-0.54 0.54l-0.54 -0.54z`);
                else parts.push(joinedModule(code, x, y));
            }
        }
    }
    return parts.join("");
}

/** The path of one eye with its top left at a place: its outer edge, its inner edge and its middle, to be filled even-odd. */
export function eyePath(x: number, y: number, eyes: EyeShape): string {
    if (eyes === "round") return circle(x + 3.5, y + 3.5, 3.5) + circle(x + 3.5, y + 3.5, 2.5) + circle(x + 3.5, y + 3.5, 1.5);
    if (eyes === "rounded") return roundRect(x, y, 7, 7, 2) + roundRect(x + 1, y + 1, 5, 5, 1.3) + roundRect(x + 2, y + 2, 3, 3, 0.9);
    return rect(x, y, 7, 7) + rect(x + 1, y + 1, 5, 5) + rect(x + 2, y + 2, 3, 3);
}

/** The path of the three eyes, to be filled even-odd. */
export function eyesPath(side: number, eyes: EyeShape): string {
    return eyePath(0, 0, eyes) + eyePath(side - 7, 0, eyes) + eyePath(0, side - 7, eyes);
}

/** Text made safe inside an SVG attribute. */
const attribute = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The fill a paint gives, and the gradient it needs, spanning the code (not its margin). */
function fillOf(paint: Paint, ground: string | undefined, side: number, id: string): { fill: string; defs: string } {
    const colors = inkColors(paint, ground);
    if (paint.kind === "solid") return { fill: attribute(paint.color), defs: "" };
    if (paint.kind === "flag") {
        // stripes from the top, each a band with hard edges
        const stops = colors.flatMap((color, i) => [`<stop offset="${n(i / colors.length)}" stop-color="${color}"/>`, `<stop offset="${n((i + 1) / colors.length)}" stop-color="${color}"/>`]).join("");
        return { fill: `url(#${id}-ink)`, defs: `<linearGradient id="${id}-ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${side}">${stops}</linearGradient>` };
    }
    const angle = paint.kind === "gradient" ? paint.angle : 45;
    const r = (angle * Math.PI) / 180;
    const half = side / 2;
    const reach = half * (Math.abs(Math.cos(r)) + Math.abs(Math.sin(r)));
    const [x1, y1, x2, y2] = [half - Math.cos(r) * reach, half - Math.sin(r) * reach, half + Math.cos(r) * reach, half + Math.sin(r) * reach];
    const stops = colors.map((color, i) => `<stop offset="${n(i / (colors.length - 1))}" stop-color="${attribute(color)}"/>`).join("");
    return { fill: `url(#${id}-ink)`, defs: `<linearGradient id="${id}-ink" gradientUnits="userSpaceOnUse" x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}">${stops}</linearGradient>` };
}

/** True for a module the patterns own (timing, alignment, format and version information, the dark module), drawn whole when a picture is the code. */
const isPattern = (code: Code, x: number, y: number) => {
    const part = code.parts[y * code.side + x];
    return part !== PART.data && part !== PART.finder && part !== PART.separator;
};

/** The halftone of a picture in thirds of a module: Floyd and Steinberg's spreading of what each third gets wrong, the middle third of each data module then set to the module's own dark or light. */
export function halftone(code: Code, light: Uint8Array): Uint8Array {
    const grid = code.side * 3;
    const values = Float32Array.from(light);
    // the picture's own range stretched to the whole, so a dim picture still gives both colors
    let low = 255;
    let high = 0;
    for (const each of values) {
        low = Math.min(low, each);
        high = Math.max(high, each);
    }
    const span = Math.max(1, high - low);
    for (let i = 0; i < values.length; i++) values[i] = ((values[i]! - low) / span) * 255;
    const dark = new Uint8Array(grid * grid);
    for (let y = 0; y < grid; y++) {
        for (let x = 0; x < grid; x++) {
            const i = y * grid + x;
            const mx = Math.floor(x / 3);
            const my = Math.floor(y / 3);
            const middle = x % 3 === 1 && y % 3 === 1;
            const forced = middle || isPattern(code, mx, my) || inEye(code, mx, my);
            const want = forced ? (darkAt(code, mx, my) ? 0 : 255) : values[i]!;
            const made = forced ? want : want < 128 ? 0 : 255;
            dark[i] = made === 0 ? 1 : 0;
            const error = forced ? 0 : want - made;
            if (x + 1 < grid) values[i + 1]! += (error * 7) / 16;
            if (y + 1 < grid) {
                if (x > 0) values[i + grid - 1]! += (error * 3) / 16;
                values[i + grid]! += (error * 5) / 16;
                if (x + 1 < grid) values[i + grid + 1]! += error / 16;
            }
        }
    }
    return dark;
}

/**
 * The SVG of a code in a look: `size` pixels a side (the viewBox counted in modules, from the margin's
 * corner), and `id` to keep its gradients apart from another SVG's on the same page. `bare` leaves out
 * the ground and the pictures, which the page lays as steady layers of its own under and over it, so
 * typing does not make a picture be decoded again.
 */
export function drawSvg(code: Code, look: Look, options: { size?: number; id?: string; title?: string; bare?: boolean } = {}): string {
    const { side } = code;
    const m = Math.max(0, Math.round(look.margin));
    const full = side + 2 * m;
    const id = options.id ?? "qr";
    const size = options.size ?? full * 8;
    const ink = fillOf(look.ink, look.ground, side, id);
    const defs: string[] = [ink.defs];
    const body: string[] = [];
    if (look.ground && !options.bare) body.push(`<rect x="${-m}" y="${-m}" width="${full}" height="${full}" fill="${attribute(look.ground)}"/>`);
    let skip: (x: number, y: number) => boolean = () => false;
    if (look.middle) {
        const { from, width } = middleSquare(side, look.middle.size);
        skip = (x, y) => x >= from && x < from + width && y >= from && y < from + width;
    }
    if (look.through) {
        const ground = look.ground ?? "#ffffff";
        if (look.through.colored) {
            // the picture in color over the code's square, the modules small over it, their middles in the code's two colors
            if (!options.bare) body.push(`<image href="${attribute(look.through.href)}" x="0" y="0" width="${side}" height="${side}" preserveAspectRatio="xMidYMid slice"/>`);
            const darkDots: string[] = [];
            const lightDots: string[] = [];
            const patternPath: string[] = [];
            for (let y = 0; y < side; y++) {
                for (let x = 0; x < side; x++) {
                    if (inEye(code, x, y)) continue;
                    const dark = darkAt(code, x, y);
                    if (isPattern(code, x, y)) {
                        (dark ? patternPath : lightDots).push(rect(x, y, 1, 1));
                        continue;
                    }
                    const dot = look.shape === "dots" ? circle(x + 0.5, y + 0.5, 0.26) : rect(x + 0.27, y + 0.27, 0.46, 0.46);
                    (dark ? darkDots : lightDots).push(dot);
                }
            }
            // the eyes and the light ring about them stand on the plain ground, so the finders are seen whole
            lightDots.push(rect(0, 0, 8, 8), rect(side - 8, 0, 8, 8), rect(0, side - 8, 8, 8));
            body.push(`<path d="${lightDots.join("")}" fill="${attribute(ground)}"/>`);
            body.push(`<path d="${patternPath.join("")}${darkDots.join("")}" fill="${ink.fill}"/>`);
        } else {
            // the halftone in thirds of a module, each row's dark thirds joined
            const dark = halftone(code, look.through.light);
            const grid = side * 3;
            const third = 1 / 3;
            const runs: string[] = [];
            for (let y = 0; y < grid; y++) {
                for (let x = 0; x < grid; ) {
                    const mx = Math.floor(x / 3);
                    const my = Math.floor(y / 3);
                    if (!dark[y * grid + x] || inEye(code, mx, my)) {
                        x++;
                        continue;
                    }
                    let end = x;
                    while (end < grid && dark[y * grid + end] && !inEye(code, Math.floor(end / 3), my)) end++;
                    runs.push(`M${n(x * third)} ${n(y * third)}h${n((end - x) * third)}v${n(third)}h${n(-(end - x) * third)}z`);
                    x = end;
                }
            }
            if (!look.ground && !options.bare) body.push(`<rect x="0" y="0" width="${side}" height="${side}" fill="#ffffff"/>`);
            body.push(`<path d="${runs.join("")}" fill="${ink.fill}"/>`);
        }
    } else {
        body.push(`<path d="${modulesPath(code, look.shape, skip)}" fill="${ink.fill}"/>`);
    }
    body.push(`<path d="${eyesPath(side, look.eyes)}" fill="${ink.fill}" fill-rule="evenodd"/>`);
    if (look.middle && !options.bare) {
        const { from, width } = middleSquare(side, look.middle.size);
        const inset = MIDDLE_INSET;
        defs.push(`<clipPath id="${id}-middle"><rect x="${n(from + inset)}" y="${n(from + inset)}" width="${n(width - 2 * inset)}" height="${n(width - 2 * inset)}" rx="${n(Math.min(1.2, width / 6))}"/></clipPath>`);
        body.push(`<image href="${attribute(look.middle.href)}" x="${n(from + inset)}" y="${n(from + inset)}" width="${n(width - 2 * inset)}" height="${n(width - 2 * inset)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}-middle)"/>`);
    }
    const title = options.title ? `<title>${attribute(options.title)}</title>` : "";
    const defsText = defs.filter(Boolean).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-m} ${-m} ${full} ${full}" width="${size}" height="${size}">${title}${defsText ? `<defs>${defsText}</defs>` : ""}${body.join("")}</svg>`;
}
