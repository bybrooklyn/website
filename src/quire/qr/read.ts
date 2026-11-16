// The reader: QR codes found in a picture, a screenshot or a photograph, turned, seen at an angle, a little
// blurred, or light on dark. The picture is made gray (what is clear counted as white) and brought to at
// most 1400 pixels a side; each pixel is called dark or light against the picture around it (the mean of
// 8 by 8 blocks, smoothed over 5 by 5 of them, as ZXing's hybrid way does), and against the whole when
// that finds nothing. The finders are the runs that go dark, light, dark three times as long, light,
// dark across a row, checked down a column, across again and along a diagonal through their middle.
// Every three finders of about one size that make a corner are tried as a code: the side is guessed
// from their distance, and from version 7 read from the version information beside two of them; the
// alignment pattern near the fourth corner is looked for; the four places fix the map from the code's
// modules to the picture, the middle of every module is read, and the square is read by `decodeGrid`. A
// code seen in a mirror is read turned back. The light-on-dark picture is the same picture turned over.
//
//   const found = readCodes({ data, width, height }); // [{ text, corners, read }]

import { decodeGrid, nearestVersion, transposed, type Read } from "./decode";
import { mapFour, through, type Map9, type Point } from "./perspective";
import { alignmentPlaces, sideOf } from "./tables";

/** A picture as the browser gives it: four bytes a pixel, red, green, blue and alpha, row by row. */
export interface Picture {
    data: Uint8ClampedArray | Uint8Array;
    width: number;
    height: number;
}

/** A code found: its text, how it was read, and its four corners in the picture (top left, top right, bottom right, bottom left, as the code is turned). */
export interface Found {
    text: string;
    read: Read;
    corners: Point[];
    /** True when it was found light on dark. */
    light: boolean;
}

/** A gray picture, one byte a pixel, 0 black. */
export interface Gray {
    data: Uint8Array;
    width: number;
    height: number;
}

/** The longest side the picture is searched at first; a picture that gives nothing there is searched again at up to twice this. */
export const SEARCH_SIDE = 1400;

/** The picture made gray, what is clear counted as white, and shrunk by whole steps of averaging until its longer side is at most `side`. */
export function grayOf(picture: Picture, side = SEARCH_SIDE): Gray {
    const step = Math.max(1, Math.ceil(Math.max(picture.width, picture.height) / side));
    const width = Math.floor(picture.width / step);
    const height = Math.floor(picture.height / step);
    const data = new Uint8Array(width * height);
    const source = picture.data;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let dy = 0; dy < step; dy++) {
                let at = ((y * step + dy) * picture.width + x * step) * 4;
                for (let dx = 0; dx < step; dx++, at += 4) {
                    const alpha = source[at + 3]!;
                    const lum = (source[at]! * 299 + source[at + 1]! * 587 + source[at + 2]! * 114) / 1000;
                    sum += (lum * alpha + 255 * (255 - alpha)) / 255;
                }
            }
            data[y * width + x] = Math.round(sum / (step * step));
        }
    }
    return { data, width, height };
}

/** A picture of dark and light, one byte a pixel, 1 dark. */
export interface Bits {
    data: Uint8Array;
    width: number;
    height: number;
}

/** Each pixel called dark or light against the picture around it: the mean of its 8 by 8 block, smoothed over the 5 by 5 blocks about it; a block of nearly one shade takes its neighbors' call. */
export function localBits(gray: Gray): Bits {
    const { width, height, data } = gray;
    if (width < 40 || height < 40) return wholeBits(gray);
    const across = Math.ceil(width / 8);
    const down = Math.ceil(height / 8);
    const points = new Float64Array(across * down);
    for (let by = 0; by < down; by++) {
        const top = Math.min(by * 8, height - 8);
        for (let bx = 0; bx < across; bx++) {
            const left = Math.min(bx * 8, width - 8);
            let sum = 0;
            let min = 255;
            let max = 0;
            for (let y = top; y < top + 8; y++) {
                for (let x = left; x < left + 8; x++) {
                    const value = data[y * width + x]!;
                    sum += value;
                    if (value < min) min = value;
                    if (value > max) max = value;
                }
            }
            let point = sum / 64;
            if (max - min <= 24) {
                // a block of one shade is most likely light; it takes its darker neighbors' measure where they have one
                point = min / 2;
                if (by > 0 && bx > 0) {
                    const near = (points[(by - 1) * across + bx]! + 2 * points[by * across + bx - 1]! + points[(by - 1) * across + bx - 1]!) / 4;
                    if (min < near) point = near;
                }
            }
            points[by * across + bx] = point;
        }
    }
    const out = new Uint8Array(width * height);
    for (let by = 0; by < down; by++) {
        const top = Math.min(by * 8, height - 8);
        const cy = Math.min(Math.max(by, 2), down - 3);
        for (let bx = 0; bx < across; bx++) {
            const left = Math.min(bx * 8, width - 8);
            const cx = Math.min(Math.max(bx, 2), across - 3);
            let sum = 0;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += points[Math.min(Math.max(cy + dy, 0), down - 1) * across + Math.min(Math.max(cx + dx, 0), across - 1)]!;
            const threshold = sum / 25;
            for (let y = top; y < top + 8; y++) for (let x = left; x < left + 8; x++) out[y * width + x] = data[y * width + x]! <= threshold ? 1 : 0;
        }
    }
    return { data: out, width, height };
}

/** Each pixel called dark or light against the whole picture, at the shade that best parts its two kinds (Otsu's way). */
export function wholeBits(gray: Gray): Bits {
    const counts = new Float64Array(256);
    for (const value of gray.data) counts[value]!++;
    const total = gray.data.length;
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * counts[i]!;
    let below = 0;
    let sumBelow = 0;
    let best = 0;
    let threshold = 127;
    for (let i = 0; i < 256; i++) {
        below += counts[i]!;
        if (below === 0 || below === total) continue;
        sumBelow += i * counts[i]!;
        const meanBelow = sumBelow / below;
        const meanAbove = (sumAll - sumBelow) / (total - below);
        const between = below * (total - below) * (meanBelow - meanAbove) ** 2;
        if (between > best) {
            best = between;
            threshold = i;
        }
    }
    return { data: Uint8Array.from(gray.data, (value) => (value <= threshold ? 1 : 0)), width: gray.width, height: gray.height };
}

/** Dark made light and light dark. */
export const turnedOver = (bits: Bits): Bits => ({ ...bits, data: bits.data.map((each) => 1 - each) });

/** A finder found: its middle, its module's size in pixels, and how many rows saw it. */
export interface Finder {
    x: number;
    y: number;
    size: number;
    count: number;
}

/** True when five runs are in the finder's proportions, 1:1:3:1:1, within `slack` of a module each. */
export function finderRuns(counts: number[], slack = 0.5): boolean {
    let total = 0;
    for (const count of counts) {
        if (count === 0) return false;
        total += count;
    }
    if (total < 7) return false;
    const module = total / 7;
    const most = module * slack;
    return Math.abs(module - counts[0]!) < most && Math.abs(module - counts[1]!) < most && Math.abs(3 * module - counts[2]!) < 3 * most && Math.abs(module - counts[3]!) < most && Math.abs(module - counts[4]!) < most;
}

/** The runs along a line through a place, outward both ways from its dark middle: up to `most` pixels for each outer run. Steps are (dx, dy) in pixels. */
function runsThrough(bits: Bits, x: number, y: number, dx: number, dy: number, most: number): { counts: number[]; back: number; ahead: number } | undefined {
    const dark = (px: number, py: number) => px >= 0 && py >= 0 && px < bits.width && py < bits.height && bits.data[py * bits.width + px] === 1;
    const inside = (px: number, py: number) => px >= 0 && py >= 0 && px < bits.width && py < bits.height;
    if (!dark(x, y)) return undefined;
    const counts = [0, 0, 0, 0, 0];
    let i = 0;
    while (inside(x - i * dx, y - i * dy) && dark(x - i * dx, y - i * dy)) i++;
    counts[2] = i;
    let j = i;
    while (inside(x - j * dx, y - j * dy) && !dark(x - j * dx, y - j * dy) && j - i <= most) j++;
    counts[1] = j - i;
    if (!inside(x - j * dx, y - j * dy) || counts[1] > most) return undefined;
    let k = j;
    while (inside(x - k * dx, y - k * dy) && dark(x - k * dx, y - k * dy) && k - j <= most) k++;
    counts[0] = k - j;
    if (counts[0] > most) return undefined;
    const back = i;
    i = 1;
    while (inside(x + i * dx, y + i * dy) && dark(x + i * dx, y + i * dy)) i++;
    counts[2] += i - 1;
    j = i;
    while (inside(x + j * dx, y + j * dy) && !dark(x + j * dx, y + j * dy) && j - i <= most) j++;
    counts[3] = j - i;
    if (!inside(x + j * dx, y + j * dy) || counts[3] > most) return undefined;
    k = j;
    while (inside(x + k * dx, y + k * dy) && dark(x + k * dx, y + k * dy) && k - j <= most) k++;
    counts[4] = k - j;
    if (counts[4] > most) return undefined;
    return { counts, back, ahead: i };
}

/** Where the middle of a finder is along a line through a place, checked against the size seen across; NaN when it is not a finder there. */
function checkAlong(bits: Bits, x: number, y: number, dx: number, dy: number, most: number, total: number, slack: number): number {
    const runs = runsThrough(bits, x, y, dx, dy, most);
    if (!runs) return NaN;
    const sum = runs.counts.reduce((a, b) => a + b, 0);
    if (5 * Math.abs(sum - total) >= 2 * total) return NaN;
    if (!finderRuns(runs.counts, slack)) return NaN;
    // the middle of the dark middle run, as an offset along the line from the place
    return (runs.ahead - runs.back) / 2;
}

/** Every finder in a picture of dark and light. */
export function findFinders(bits: Bits): Finder[] {
    const found: Finder[] = [];
    const { width, height, data } = bits;
    const skip = width * height > 1_200_000 ? 2 : 1;
    const consider = (counts: number[], y: number, end: number) => {
        const total = counts.reduce((a, b) => a + b, 0);
        let cx = end - counts[4]! - counts[3]! - counts[2]! / 2;
        const down = checkAlong(bits, Math.floor(cx), y, 0, 1, counts[2]!, total, 0.5);
        if (Number.isNaN(down)) return;
        const cy = y + down;
        const across = checkAlong(bits, Math.floor(cx), Math.floor(cy), 1, 0, counts[2]!, total, 0.5);
        if (Number.isNaN(across)) return;
        cx = Math.floor(cx) + across;
        // a diagonal through the middle must be a finder too, looser, as a turned code stretches it
        if (Number.isNaN(checkAlong(bits, Math.floor(cx), Math.floor(cy), 1, 1, counts[2]! * 2, total, 0.75)) && Number.isNaN(checkAlong(bits, Math.floor(cx), Math.floor(cy), 1, -1, counts[2]! * 2, total, 0.75))) return;
        const size = total / 7;
        for (const each of found) {
            if (Math.abs(each.x - cx) <= size && Math.abs(each.y - cy) <= size && Math.abs(each.size - size) <= Math.max(1, each.size * 0.5)) {
                const weight = each.count;
                each.x = (each.x * weight + cx) / (weight + 1);
                each.y = (each.y * weight + cy) / (weight + 1);
                each.size = (each.size * weight + size) / (weight + 1);
                each.count++;
                return;
            }
        }
        found.push({ x: cx, y: cy, size, count: 1 });
    };
    for (let y = 0; y < height; y += skip) {
        const counts = [0, 0, 0, 0, 0];
        let state = 0;
        const row = y * width;
        for (let x = 0; x < width; x++) {
            if (data[row + x] === 1) {
                if (state & 1) state++;
                counts[state]!++;
            } else if (!(state & 1)) {
                if (state === 4) {
                    if (finderRuns(counts)) {
                        consider(counts, y, x);
                        counts.fill(0);
                        counts[1] = 1;
                        state = 1;
                    } else {
                        counts[0] = counts[2]!;
                        counts[1] = counts[3]!;
                        counts[2] = counts[4]!;
                        counts[3] = 1;
                        counts[4] = 0;
                        state = 3;
                    }
                } else counts[++state]!++;
            } else counts[state]!++;
        }
        if (state === 4 && finderRuns(counts)) consider(counts, y, width);
    }
    return found;
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Three finders put in order as a code's corners, top left, top right and bottom left; undefined when they do not make a corner. */
export function corner(a: Finder, b: Finder, c: Finder): [Finder, Finder, Finder] | undefined {
    const sizes = [a.size, b.size, c.size];
    if (Math.max(...sizes) / Math.min(...sizes) > 1.8) return undefined;
    const ab = distance(a, b);
    const bc = distance(b, c);
    const ac = distance(a, c);
    let top: Finder, one: Finder, two: Finder, long: number, legs: [number, number];
    if (bc >= ab && bc >= ac) [top, one, two, long, legs] = [a, b, c, bc, [ab, ac]];
    else if (ac >= ab) [top, one, two, long, legs] = [b, a, c, ac, [ab, bc]];
    else [top, one, two, long, legs] = [c, a, b, ab, [ac, bc]];
    if (Math.max(...legs) / Math.min(...legs) > 1.8) return undefined;
    const square = legs[0] ** 2 + legs[1] ** 2;
    if (Math.abs(long ** 2 - square) > 0.5 * square) return undefined;
    const size = (a.size + b.size + c.size) / 3;
    if (Math.min(...legs) / size < 10 || Math.max(...legs) / size > 200) return undefined;
    // the top right is the one a turn the right way (clockwise on screen) from the bottom left
    const cross = (one.x - top.x) * (two.y - top.y) - (one.y - top.y) * (two.x - top.x);
    return cross > 0 ? [top, one, two] : [top, two, one];
}

/** The module's size along a line from one finder toward another: the dark, light, dark runs out from its middle both ways, which span seven modules. */
function moduleAlong(bits: Bits, from: Point, toward: Point): number {
    const one = runToEdge(bits, from, toward);
    const other = runToEdge(bits, from, { x: 2 * from.x - toward.x, y: 2 * from.y - toward.y });
    if (Number.isNaN(one) && Number.isNaN(other)) return NaN;
    if (Number.isNaN(one)) return other / 3.5;
    if (Number.isNaN(other)) return one / 3.5;
    return (one + other) / 7;
}

/** How far from a finder's middle, along a line, its outer dark ring ends: three changes of shade out. */
function runToEdge(bits: Bits, from: Point, toward: Point): number {
    const length = distance(from, toward);
    if (length < 1) return NaN;
    const dx = (toward.x - from.x) / length;
    const dy = (toward.y - from.y) / length;
    let changes = 0;
    let was = 1;
    for (let step = 0; step < length; step += 0.5) {
        const x = Math.round(from.x + dx * step);
        const y = Math.round(from.y + dy * step);
        if (x < 0 || y < 0 || x >= bits.width || y >= bits.height) return NaN;
        const now = bits.data[y * bits.width + x]!;
        if (now !== was) {
            changes++;
            was = now;
            if (changes === 3) return step;
        }
    }
    return NaN;
}

/** The modules a side the three finders suggest: their distances over the module's size, plus seven, made one more than a multiple of four. */
export function guessSide(bits: Bits, top: Finder, right: Finder, left: Finder): number {
    const across = moduleAlong(bits, top, right) + moduleAlong(bits, right, top);
    const down = moduleAlong(bits, top, left) + moduleAlong(bits, left, top);
    const sizeAcross = Number.isNaN(across) ? (top.size + right.size) / 2 : across / 2;
    const sizeDown = Number.isNaN(down) ? (top.size + left.size) / 2 : down / 2;
    const raw = (distance(top, right) / sizeAcross + distance(top, left) / sizeDown) / 2 + 7;
    return Math.round((raw - 17) / 4) * 4 + 17;
}

/** The value of a pixel of a picture of dark and light, 0 outside it. */
const bitAt = (bits: Bits, x: number, y: number): number => {
    const px = Math.round(x);
    const py = Math.round(y);
    return px >= 0 && py >= 0 && px < bits.width && py < bits.height ? bits.data[py * bits.width + px]! : 0;
};

/**
 * A first guess at where each module of a code is seen, from three finders: their middles, and the
 * perspective their module sizes show, as the modules of a code tilted away are smaller on its far side.
 * Along the top edge a perspective map runs as `a t / (1 + g t)`, so the module's size at the top right
 * over its size at the top left is `1 / (1 + g d)^2`, d the finders' distance in modules; the same down
 * the left edge. Given a module's place (x across, y down), it gives the pixel.
 */
export function guessMap(bits: Bits, top: Finder, right: Finder, left: Finder, side: number): (x: number, y: number) => Point {
    const d = side - 7;
    const ratio = (near: number, far: number) => (near > 0 && far > 0 ? Math.min(2.5, Math.max(0.4, far / near)) : 1);
    const g = (1 / Math.sqrt(ratio(moduleAlong(bits, top, right), moduleAlong(bits, right, top))) - 1) / d;
    const h = (1 / Math.sqrt(ratio(moduleAlong(bits, top, left), moduleAlong(bits, left, top))) - 1) / d;
    const a = { x: ((right.x - top.x) * (1 + g * d)) / d, y: ((right.y - top.y) * (1 + g * d)) / d };
    const b = { x: ((left.x - top.x) * (1 + h * d)) / d, y: ((left.y - top.y) * (1 + h * d)) / d };
    return (x, y) => {
        const p = x - 3.5;
        const q = y - 3.5;
        const w = 1 + g * p + h * q;
        return { x: top.x + (a.x * p + b.x * q) / w, y: top.y + (a.y * p + b.y * q) / w };
    };
}

/** The version read from its information beside the top right and the bottom left finders, where the first guess puts it; undefined when neither copy reads. */
function readVersionNear(bits: Bits, guess: (x: number, y: number) => Point, side: number): number | undefined {
    let besideRight = 0;
    let besideLeft = 0;
    for (let i = 0; i < 18; i++) {
        const a = side - 11 + (i % 3) + 0.5;
        const b = Math.floor(i / 3) + 0.5;
        const r = guess(a, b);
        besideRight |= bitAt(bits, r.x, r.y) << i;
        const l = guess(b, a);
        besideLeft |= bitAt(bits, l.x, l.y) << i;
    }
    return nearestVersion(besideRight) ?? nearestVersion(besideLeft);
}

/** The steps of one module across and down at a place, by the first guess. */
function stepsAt(guess: (x: number, y: number) => Point, x: number, y: number): { at: Point; across: Point; down: Point } {
    const at = guess(x, y);
    const right = guess(x + 1, y);
    const below = guess(x, y + 1);
    return { at, across: { x: right.x - at.x, y: right.y - at.y }, down: { x: below.x - at.x, y: below.y - at.y } };
}

/** Where the alignment pattern nearest the fourth corner is, looked for within `reach` modules of where the first guess puts it; undefined when nothing there looks like one. */
function findAlignment(bits: Bits, guess: (x: number, y: number) => Point, side: number, reach: number): Point | undefined {
    // its middle is at (side - 6.5, side - 6.5), three modules in from the fourth corner's finder-like place
    const { at: expected, across, down } = stepsAt(guess, side - 6.5, side - 6.5);
    const module = (Math.hypot(across.x, across.y) + Math.hypot(down.x, down.y)) / 2;
    const step = Math.max(0.5, module / 3);
    let best: { at: Point; score: number } | undefined;
    for (let oy = -reach * module; oy <= reach * module; oy += step) {
        for (let ox = -reach * module; ox <= reach * module; ox += step) {
            const at = { x: expected.x + ox, y: expected.y + oy };
            let matches = 0;
            for (let my = -2; my <= 2; my++) {
                for (let mx = -2; mx <= 2; mx++) {
                    const want = Math.max(Math.abs(mx), Math.abs(my)) === 1 ? 0 : 1;
                    if (bitAt(bits, at.x + across.x * mx + down.x * my, at.y + across.y * mx + down.y * my) === want) matches++;
                }
            }
            // a nearer match is worth a little more, as the data around can look like one by chance
            const score = matches - Math.hypot(ox, oy) / module / (reach * 4);
            if (matches >= 22 && (!best || score > best.score)) best = { at, score };
        }
    }
    return best?.at;
}

/** The square of modules read off the picture through a map from modules to pixels, each at its middle. */
export function sample(bits: Bits, map: Map9, side: number): Uint8Array {
    const modules = new Uint8Array(side * side);
    for (let y = 0; y < side; y++) {
        for (let x = 0; x < side; x++) {
            const seen = through(map, x + 0.5, y + 0.5);
            modules[y * side + x] = bitAt(bits, seen.x, seen.y);
        }
    }
    return modules;
}

/** Tries three finders as a code, every way that might fit; the code read and its corners, or undefined. */
function tryCorner(bits: Bits, [top, right, left]: [Finder, Finder, Finder]): { read: Read; corners: Point[] } | undefined {
    const guessed = guessSide(bits, top, right, left);
    const sides: number[] = [];
    if (guessed >= 45) {
        const version = readVersionNear(bits, guessMap(bits, top, right, left, guessed), guessed);
        if (version) sides.push(sideOf(version));
    }
    for (const each of [guessed, guessed - 4, guessed + 4]) if (each >= 21 && each <= 177 && !sides.includes(each)) sides.push(each);
    for (const side of sides) {
        const guess = guessMap(bits, top, right, left, side);
        const fourths: Point[] = [];
        const version = (side - 17) / 4;
        if (alignmentPlaces(version).length) {
            for (const reach of [4, 9]) {
                const found = findAlignment(bits, guess, side, reach);
                if (found) {
                    fourths.push(found);
                    break;
                }
            }
        }
        // the first guess's fourth corner, the parallelogram's, then places around the first, nearest first
        const aligned = fourths.length;
        const { at: plain, across, down } = stepsAt(guess, side - 3.5, side - 3.5);
        fourths.push(plain, { x: right.x + left.x - top.x, y: right.y + left.y - top.y });
        const reach = side <= 41 ? 5 : 2;
        const offsets: [number, number][] = [];
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) if (dx || dy) offsets.push([dx, dy]);
        offsets.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
        for (const [dx, dy] of offsets) fourths.push({ x: plain.x + across.x * dx + down.x * dy, y: plain.y + across.y * dx + down.y * dy });
        for (const [index, fourth] of fourths.entries()) {
            const from = [
                { x: 3.5, y: 3.5 },
                { x: side - 3.5, y: 3.5 },
                { x: 3.5, y: side - 3.5 },
                index < aligned ? { x: side - 6.5, y: side - 6.5 } : { x: side - 3.5, y: side - 3.5 },
            ];
            const map = mapFour(from, [top, right, left, fourth]);
            if (!map) continue;
            const modules = sample(bits, map, side);
            const read = decodeGrid(modules, side) ?? decodeGrid(transposed(modules, side), side);
            if (read) {
                const corners = [through(map, 0, 0), through(map, side, 0), through(map, side, side), through(map, 0, side)];
                return { read, corners };
            }
        }
    }
    return undefined;
}

/** Every code found in a picture of dark and light: each three finders that make a corner tried, most seen first, a finder used once. */
export function codesIn(bits: Bits): { read: Read; corners: Point[] }[] {
    const finders = findFinders(bits)
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);
    const steady = finders.filter((each) => each.count >= 2);
    const pool = steady.length >= 3 ? steady : finders;
    const tried: { corner: [Finder, Finder, Finder]; fit: number }[] = [];
    for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
            for (let k = j + 1; k < pool.length; k++) {
                const made = corner(pool[i]!, pool[j]!, pool[k]!);
                if (!made) continue;
                const [t, r, l] = made;
                const legs = [distance(t, r), distance(t, l)];
                const fit = Math.abs(legs[0]! - legs[1]!) / Math.max(...legs) + Math.abs(t.size - r.size) / t.size + Math.abs(t.size - l.size) / t.size;
                tried.push({ corner: made, fit });
            }
        }
    }
    tried.sort((a, b) => a.fit - b.fit);
    const used = new Set<Finder>();
    const out: { read: Read; corners: Point[] }[] = [];
    for (const { corner: made } of tried.slice(0, 200)) {
        if (made.some((each) => used.has(each))) continue;
        const read = tryCorner(bits, made);
        if (!read) continue;
        for (const each of made) used.add(each);
        out.push(read);
    }
    return out;
}

/** Every QR code in a picture, as dark on light and as light on dark; the same code seen twice is given once. */
export function readCodes(picture: Picture): Found[] {
    const found: Found[] = [];
    const add = (codes: { read: Read; corners: Point[] }[], scale: number, light: boolean) => {
        for (const code of codes) {
            const corners = code.corners.map((each) => ({ x: each.x * scale, y: each.y * scale }));
            const middle = { x: corners.reduce((s, c) => s + c.x, 0) / 4, y: corners.reduce((s, c) => s + c.y, 0) / 4 };
            const size = distance(corners[0]!, corners[2]!);
            const again = found.some((each) => each.text === code.read.text && distance({ x: each.corners.reduce((s, c) => s + c.x, 0) / 4, y: each.corners.reduce((s, c) => s + c.y, 0) / 4 }, middle) < size / 2);
            if (!again) found.push({ text: code.read.text, read: code.read, corners, light });
        }
    };
    const sides = Math.max(picture.width, picture.height) > SEARCH_SIDE ? [SEARCH_SIDE, SEARCH_SIDE * 2] : [SEARCH_SIDE];
    for (const side of sides) {
        const gray = grayOf(picture, side);
        const scale = picture.width / gray.width;
        const local = localBits(gray);
        add(codesIn(local), scale, false);
        add(codesIn(turnedOver(local)), scale, true);
        if (found.length) break;
        const whole = wholeBits(gray);
        add(codesIn(whole), scale, false);
        add(codesIn(turnedOver(whole)), scale, true);
        if (found.length) break;
    }
    return found;
}
