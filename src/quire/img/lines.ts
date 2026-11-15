// Finding a picture's straight lines and where they meet, for perspective's one press. The picture is read
// small and grey; its edges are found by their gradient, and pixels whose edges run the same way are grown
// into regions, each fitted with a line (`segments`, after the line segment detector of von Gioi and
// others, much simplified). The lines nearer upright than 30 degrees are put to a vote for where they meet
// (`meeting`): every pair's crossing, and their meeting far away, is scored by the length of the lines that
// point at it within a degree and a half, and the best is refined by least squares. Lines that are many,
// long and spread across the picture are clear; then the camera's turn that stands them upright is worked
// out (`straighten`): its tilt and its turn left or right for the two keystone dials, and its roll for the
// horizon's dial. The lines nearer flat are used too, where they are clear and need only a small turn.
//
//   const lines = segments(grey, width, height);
//   const fix = straighten(lines, { width, height }, { width: 4000, height: 3000 });   undefined, or degrees

import { assumedFocal } from "./homography";

/** A line found in a picture: its two ends, in the pixels of the picture it was found in, and its length. */
export interface Segment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    length: number;
}

/** A picture's pixels as grey, from 0 to 1, from RGBA bytes. */
export function grey(data: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array {
    const out = new Float32Array(width * height);
    for (let at = 0; at < out.length; at++) out[at] = (0.299 * data[at * 4]! + 0.587 * data[at * 4 + 1]! + 0.114 * data[at * 4 + 2]!) / 255;
    return out;
}

/**
 * The straight lines in a grey picture: pixels with a strong edge, grown into regions whose edges run the
 * same way within 22.5 degrees, each region fitted by its weighted middle and main direction, kept when it
 * is long (at least `least` pixels, or 4 percent of the longer side) and thin (no wider than an eighth of
 * its length, and three pixels at least).
 */
export function segments(picture: Float32Array, width: number, height: number, least = Math.max(16, Math.round(Math.max(width, height) * 0.04))): Segment[] {
    const count = width * height;
    const magnitude = new Float32Array(count);
    const angle = new Float32Array(count);
    for (let y = 1; y < height - 1; y++)
        for (let x = 1; x < width - 1; x++) {
            const at = y * width + x;
            const p = (dx: number, dy: number) => picture[at + dy * width + dx]!;
            const gx = p(1, -1) + 2 * p(1, 0) + p(1, 1) - p(-1, -1) - 2 * p(-1, 0) - p(-1, 1);
            const gy = p(-1, 1) + 2 * p(0, 1) + p(1, 1) - p(-1, -1) - 2 * p(0, -1) - p(1, -1);
            magnitude[at] = Math.hypot(gx, gy) / 4;
            // the edge's own direction, across the gradient, folded into half a turn
            let a = Math.atan2(gx, -gy);
            if (a < 0) a += Math.PI;
            if (a >= Math.PI) a -= Math.PI;
            angle[at] = a;
        }
    // a strong edge: above a fixed floor, and above three times the picture's middle edge so that a busy texture does not count
    const sample: number[] = [];
    for (let at = 0; at < count; at += Math.max(1, Math.floor(count / 20000))) sample.push(magnitude[at]!);
    sample.sort((a, b) => a - b);
    const strong = Math.max(0.035, 3 * (sample[Math.floor(sample.length / 2)] ?? 0));
    const seeds: number[] = [];
    for (let at = 0; at < count; at++) if (magnitude[at]! > strong) seeds.push(at);
    seeds.sort((a, b) => magnitude[b]! - magnitude[a]!);
    const used = new Uint8Array(count);
    const found: Segment[] = [];
    const tolerance = Math.PI / 8;
    const apart = (a: number, b: number) => {
        const d = Math.abs(a - b) % Math.PI;
        return Math.min(d, Math.PI - d);
    };
    const region: number[] = [];
    for (const seed of seeds) {
        if (used[seed]) continue;
        region.length = 0;
        region.push(seed);
        used[seed] = 1;
        // the region's direction as a doubled angle's mean, so that directions half a turn apart agree
        let sx = Math.cos(2 * angle[seed]!);
        let sy = Math.sin(2 * angle[seed]!);
        for (let next = 0; next < region.length && region.length < 20000; next++) {
            const at = region[next]!;
            const x = at % width;
            const y = (at - x) / width;
            const mean = Math.atan2(sy, sx) / 2;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 1 || ny < 1 || nx >= width - 1 || ny >= height - 1) continue;
                    const there = ny * width + nx;
                    if (used[there] || magnitude[there]! <= strong || apart(angle[there]!, mean) > tolerance) continue;
                    used[there] = 1;
                    region.push(there);
                    sx += Math.cos(2 * angle[there]!);
                    sy += Math.sin(2 * angle[there]!);
                }
        }
        if (region.length < least) continue;
        // the weighted middle and the main direction of the region's pixels
        let total = 0;
        let mx = 0;
        let my = 0;
        for (const at of region) {
            const w = magnitude[at]!;
            total += w;
            mx += w * (at % width);
            my += w * Math.floor(at / width);
        }
        mx /= total;
        my /= total;
        let xx = 0;
        let xy = 0;
        let yy = 0;
        for (const at of region) {
            const w = magnitude[at]!;
            const dx = (at % width) - mx;
            const dy = Math.floor(at / width) - my;
            xx += w * dx * dx;
            xy += w * dx * dy;
            yy += w * dy * dy;
        }
        const direction = 0.5 * Math.atan2(2 * xy, xx - yy);
        const ux = Math.cos(direction);
        const uy = Math.sin(direction);
        let low = Infinity;
        let high = -Infinity;
        let wide = 0;
        for (const at of region) {
            const dx = (at % width) - mx;
            const dy = Math.floor(at / width) - my;
            const along = dx * ux + dy * uy;
            low = Math.min(low, along);
            high = Math.max(high, along);
            wide = Math.max(wide, Math.abs(-dx * uy + dy * ux));
        }
        const length = high - low;
        if (length < least || 2 * wide > Math.max(3, length / 8)) continue;
        found.push({ x1: mx + ux * low, y1: my + uy * low, x2: mx + ux * high, y2: my + uy * high, length });
    }
    return found;
}

/** A meeting place of lines, in the same pixels, as three numbers (x, y, w): a place at (x / w, y / w), or far away in the direction (x, y) when w is zero. */
export type Meeting = [number, number, number];

/** How far, in degrees, a line points away from a meeting place, seen from its middle. */
function aside(segment: Segment, meeting: Meeting): number {
    const mx = (segment.x1 + segment.x2) / 2;
    const my = (segment.y1 + segment.y2) / 2;
    const tx = meeting[2] ? meeting[0] / meeting[2] - mx : meeting[0];
    const ty = meeting[2] ? meeting[1] / meeting[2] - my : meeting[1];
    const dx = segment.x2 - segment.x1;
    const dy = segment.y2 - segment.y1;
    const cos = Math.abs(dx * tx + dy * ty) / Math.max(1e-12, Math.hypot(dx, dy) * Math.hypot(tx, ty));
    return (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
}

/** The smallest eigenvector of a 3 by 3 symmetric matrix, by Jacobi's turns. */
function smallest(m: number[]): [number, number, number] {
    const a = [...m];
    const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (let sweep = 0; sweep < 30; sweep++)
        for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
            const apq = a[p * 3 + q]!;
            if (Math.abs(apq) < 1e-18) continue;
            const theta = (a[q * 3 + q]! - a[p * 3 + p]!) / (2 * apq);
            const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
            const c = 1 / Math.sqrt(t * t + 1);
            const s = t * c;
            for (let k = 0; k < 3; k++) {
                const akp = a[k * 3 + p]!;
                const akq = a[k * 3 + q]!;
                a[k * 3 + p] = c * akp - s * akq;
                a[k * 3 + q] = s * akp + c * akq;
            }
            for (let k = 0; k < 3; k++) {
                const apk = a[p * 3 + k]!;
                const aqk = a[q * 3 + k]!;
                a[p * 3 + k] = c * apk - s * aqk;
                a[q * 3 + k] = s * apk + c * aqk;
            }
            for (let k = 0; k < 3; k++) {
                const vkp = v[k * 3 + p]!;
                const vkq = v[k * 3 + q]!;
                v[k * 3 + p] = c * vkp - s * vkq;
                v[k * 3 + q] = s * vkp + c * vkq;
            }
        }
    let best = 0;
    for (let k = 1; k < 3; k++) if (a[k * 4]! < a[best * 4]!) best = k;
    return [v[best]!, v[3 + best]!, v[6 + best]!];
}

/** Where a set of lines meets, and the lines that point there: put to a vote among the crossings of the longest forty, and far away in their average direction, then refined by least squares over the lines that agree. Undefined with fewer than two lines. */
export function meeting(lines: Segment[], within = 1.5): { meeting: Meeting; agreeing: Segment[] } | undefined {
    if (lines.length < 2) return undefined;
    const longest = [...lines].sort((a, b) => b.length - a.length).slice(0, 40);
    const homogeneous = (s: Segment): [number, number, number] => [s.y1 - s.y2, s.x2 - s.x1, s.x1 * s.y2 - s.x2 * s.y1];
    const candidates: Meeting[] = [];
    // far away: the lines' average direction, each counted by its length
    let sx = 0;
    let sy = 0;
    for (const s of lines) {
        const a = 2 * Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        sx += s.length * Math.cos(a);
        sy += s.length * Math.sin(a);
    }
    const mean = Math.atan2(sy, sx) / 2;
    candidates.push([Math.cos(mean), Math.sin(mean), 0]);
    for (let i = 0; i < longest.length; i++)
        for (let j = i + 1; j < longest.length; j++) {
            const a = homogeneous(longest[i]!);
            const b = homogeneous(longest[j]!);
            const c: Meeting = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
            const size = Math.hypot(...c);
            if (size > 0) candidates.push(c.map((value) => value / size) as Meeting);
        }
    const scored = (candidate: Meeting) => lines.reduce((sum, s) => (aside(s, candidate) < within ? sum + s.length : sum), 0);
    let best = candidates[0]!;
    let most = -1;
    for (const candidate of candidates) {
        const score = scored(candidate);
        if (score > most) [most, best] = [score, candidate];
    }
    let agreeing = lines.filter((s) => aside(s, best) < within);
    if (agreeing.length >= 2) {
        // least squares: the place nearest all the agreeing lines, each line's equation scaled to unit size and counted by its length
        const m = new Array(9).fill(0);
        for (const s of agreeing) {
            const l = homogeneous(s);
            const size = Math.hypot(l[0], l[1]) || 1;
            const n = [l[0] / size, l[1] / size, l[2] / size];
            for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[r * 3 + c] += s.length * n[r]! * n[c]!;
        }
        const refined = smallest(m);
        if (scored(refined) >= most * 0.98) {
            best = refined;
            agreeing = lines.filter((s) => aside(s, best) < within);
        }
    }
    return { meeting: best, agreeing };
}

/** The turns that straighten a picture, in degrees: the tilt and the turn left or right of the camera (the keystone dials) and its roll (the horizon's dial). */
export interface Straightening {
    vertical: number;
    horizontal: number;
    turn: number;
    /** How many lines it stood upright, and how many it made level. */
    upright: number;
    level: number;
}

/** The most the one press turns the camera any way, in degrees: past this, the lines are taken to be something other than a building's or a page's. */
export const MOST_TILT = 30;

/**
 * The turn of the camera that stands a picture's upright lines straight, from lines found in a copy of
 * it of some size (`small`) and the original's size: the lines within 30 degrees of upright must be at
 * least three, together at least half the copy's height long, and spread over a fifth of its width, and at
 * least half their length must meet in one place; else there is nothing clear and undefined is given. The
 * lines within 30 degrees of flat are made level too when they are as clear and need a turn of at most 20
 * degrees. Worked with the focal length taken for a picture (`assumedFocal`).
 */
export function straighten(lines: Segment[], small: { width: number; height: number }, size: { width: number; height: number }): Straightening | undefined {
    const scale = size.width / small.width;
    const tilt = (s: Segment) => (Math.atan2(Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1)) * 180) / Math.PI;
    const uprights = lines.filter((s) => tilt(s) < 30);
    const flats = lines.filter((s) => tilt(s) > 60);
    const clear = (group: Segment[], across: "x" | "y") => {
        const total = group.reduce((sum, s) => sum + s.length, 0);
        const found = meeting(group);
        if (!found || found.agreeing.length < 3) return undefined;
        const agreeing = found.agreeing.reduce((sum, s) => sum + s.length, 0);
        const middles = found.agreeing.map((s) => (across === "x" ? s.x1 + s.x2 : s.y1 + s.y2) / 2);
        const spread = Math.max(...middles) - Math.min(...middles);
        const room = across === "x" ? small.width : small.height;
        const reach = across === "x" ? small.height : small.width;
        if (agreeing < reach * 0.5 || agreeing < total * 0.5 || spread < room * 0.2) return undefined;
        return found;
    };
    const up = clear(uprights, "x");
    if (!up) return undefined;
    // the meeting places as directions from the camera, in the original's pixels about its middle
    const focal = assumedFocal(size);
    const toRay = (m: Meeting): number[] => {
        const x = m[0] * scale - (m[2] * size.width) / 2;
        const y = m[1] * scale - (m[2] * size.height) / 2;
        const ray = [x / focal, y / focal, m[2]];
        const long = Math.hypot(...ray);
        return ray.map((value) => value / long);
    };
    const down = toRay(up.meeting);
    // the upright direction points down the picture
    if (down[1]! < 0) for (let k = 0; k < 3; k++) down[k] = -down[k]!;
    const unit = (v: number[]) => {
        const long = Math.hypot(...v);
        return v.map((value) => value / long);
    };
    const minus = (a: number[], b: number[], times: number) => a.map((value, k) => value - b[k]! * times);
    const dotted = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    let across = unit(minus([1, 0, 0], down, down[0]!));
    let level = 0;
    const flat = clear(flats, "y");
    if (flat) {
        const ray = toRay(flat.meeting);
        if (ray[0]! < 0) for (let k = 0; k < 3; k++) ray[k] = -ray[k]!;
        const made = unit(minus(ray, down, dotted(ray, down)));
        across = made;
        level = flat.agreeing.length;
    }
    // the camera's new axes: across, down, and forward as their cross, as the rows of its turn
    const forward = [across[1]! * down[2]! - across[2]! * down[1]!, across[2]! * down[0]! - across[0]! * down[2]!, across[0]! * down[1]! - across[1]! * down[0]!];
    // the turn is roll after a turn left or right after a tilt: R = Rz Ry Rx, read back from its last row and first column
    const r20 = forward[0]!;
    const r21 = forward[1]!;
    const r22 = forward[2]!;
    const r10 = down[0]!;
    const r00 = across[0]!;
    const degrees = (radians: number) => (radians * 180) / Math.PI;
    const horizontal = degrees(-Math.asin(Math.max(-1, Math.min(1, r20))));
    const vertical = degrees(Math.atan2(r21, r22));
    const turn = degrees(Math.atan2(r10, r00));
    const without = flat && Math.abs(horizontal) > 20;
    if (without) return straighten(lines.filter((s) => tilt(s) < 30), small, size);
    if (Math.abs(vertical) > MOST_TILT || Math.abs(horizontal) > MOST_TILT || Math.abs(turn) > 15) return undefined;
    const tenth = (value: number) => Math.round(value * 10) / 10 || 0;
    return { vertical: tenth(vertical), horizontal: tenth(horizontal), turn: tenth(turn), upright: up.agreeing.length, level };
}
