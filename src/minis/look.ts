// The look of the marble run, as data for Mote's drawing (gl.ts patterns): which marble is which, by its
// number, so that a run replayed looks the same; each piece of wood a grain of its own; and the places in
// the pattern for boxes, panes of glass and the solids of moving parts, so that oak's grain runs along
// a box's length and glass shows its edges. marbles.ts draws with these.
//
//   marbleLook(7);        // { seed, tints }: a clear marble with a ribbon in the trans flag's colors, say
//   grainedBox([3, 0.4, 1], [0, 2, 0]);  // a box whose grain runs along its longest side

import { block, type Mesh, type V3 } from "../mote/solids";
import { FLAGS, rgb } from "./flags";

/** A color as red, green and blue from 0 to 1, as gl.ts takes it. */
export type Color = [number, number, number];

/** A number from 0 to 1 for a whole number and a salt, the same everywhere: for choosing by number. */
export function hashed(n: number, salt = 0): number {
    let h = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca77)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fromHex = (hex: string): Color => rgb(hex).map((value) => value / 255) as Color;

/** A color written in OKLCH, as red, green and blue from 0 to 1 (the page's accents are written so). */
export function oklch(lightness: number, chroma: number, hue: number): Color {
    const [a, b] = [chroma * Math.cos((hue * Math.PI) / 180), chroma * Math.sin((hue * Math.PI) / 180)];
    const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
    return linear.map((c) => {
        const x = Math.max(0, Math.min(1, c));
        return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    }) as Color;
}

/**
 * The ribbons a marble can have: three vanes, each a stripe of a pride flag (the trans and lesbian
 * flags, the site's own, come twice as often), or the site's own accents. A flag's near black stripe is
 * left out, since a black vane in clear glass reads as a hole.
 */
export const RIBBONS: Color[][] = (() => {
    const flag = (name: string) => FLAGS.find((one) => one.name === name)!.stripes.map(fromHex).filter((c) => c[0] + c[1] + c[2] > 0.5);
    const unique = (colors: Color[]) => colors.filter((c, i) => colors.findIndex((d) => d.every((v, k) => Math.abs(v - c[k]!) < 1e-6)) === i);
    const accents = [oklch(0.77, 0.16, 300), oklch(0.78, 0.15, 350), oklch(0.78, 0.12, 250), oklch(0.84, 0.12, 165), oklch(0.84, 0.13, 80)];
    const flags = ["trans", "trans", "lesbian", "lesbian", "rainbow", "bisexual", "pansexual", "nonbinary"].map((name) => unique(flag(name)));
    return [...flags, accents];
})();

/** The kinds of marble: most are clear glass with a ribbon inside, some opaque glass with a stripe, and the odd one steel. */
export type MarbleKind = "clear" | "opaque" | "steel";

/** What a marble looks like, by its number: its kind and its variety as gl.ts's seed (the kind's number, and a fraction), and the three colors of its ribbon or its stripe. */
export function marbleLook(number: number): { kind: MarbleKind; seed: number; tints: [Color, Color, Color] } {
    const pick = hashed(number, 1);
    // the first marble is always a clear one, so that the first thing let go shows what they are
    const kind: MarbleKind = number === 0 || pick < 0.68 ? "clear" : pick < 0.92 ? "opaque" : "steel";
    const ribbon = RIBBONS[Math.floor(hashed(number, 2) * RIBBONS.length)]!;
    const start = Math.floor(hashed(number, 3) * ribbon.length);
    const at = (k: number) => ribbon[(start + k) % ribbon.length]!;
    const tints: [Color, Color, Color] = [at(0), at(1), at(2)];
    const seed = { clear: 0, opaque: 1, steel: 2 }[kind] + Math.min(0.999, hashed(number, 4));
    return { kind, seed, tints };
}

/** A number for a piece of wood from the piece's own number, so that each piece has its own grain and tone and keeps it. */
export const woodSeed = (id: number): number => hashed(id, 5) * 97;

/** The order of a box's axes from longest to shortest. */
const longest = (half: V3): [number, number, number] => ([0, 1, 2] as const).slice().sort((a, b) => half[b]! - half[a]!) as [number, number, number];

/** A mesh given places in the grain: its own places, turned so that the grain runs along its longest side. */
export function grained(mesh: Mesh): Mesh {
    const low: V3 = [Infinity, Infinity, Infinity];
    const high: V3 = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.points) for (let axis = 0; axis < 3; axis++) [low[axis], high[axis]] = [Math.min(low[axis]!, p[axis]!), Math.max(high[axis]!, p[axis]!)];
    const [a, b, c] = longest([high[0] - low[0], high[1] - low[1], high[2] - low[2]]);
    return { ...mesh, grain: mesh.points.map((p): V3 => [p[a]!, p[b]!, p[c]!]) };
}

/** A box of wood at a place, its grain along its longest side; boxes of one piece share its wood, since the grain is reckoned from the piece's own place. */
export function grainedBox(half: V3, at: V3 = [0, 0, 0]): Mesh {
    const box = block(half);
    const [a, b, c] = longest(half);
    const points = box.points.map((p): V3 => [p[0] + at[0], p[1] + at[1], p[2] + at[2]]);
    return { ...box, points, grain: points.map((p): V3 => [p[a]!, p[b]!, p[c]!]) };
}

/** A pane of glass at a place: its places in the pattern run from -1 to 1 across it each way, so that the shader finds its edges. */
export function pane(half: V3, at: V3): Mesh {
    const box = block(half);
    return { ...box, points: box.points.map((p): V3 => [p[0] + at[0], p[1] + at[1], p[2] + at[2]]), grain: box.points.map((p): V3 => [Math.sign(p[0]), Math.sign(p[1]), Math.sign(p[2])]) };
}

/** One mesh of several, each moved by `by`, their places in the pattern kept (a mesh with none given its own places, moved): for drawing a piece's parts as one. */
export function merged(meshes: { mesh: Mesh; by?: V3 }[], smooth: boolean): Mesh | undefined {
    if (!meshes.length) return undefined;
    const points: V3[] = [];
    const faces: number[][] = [];
    const grain: V3[] = [];
    const any = meshes.some(({ mesh }) => mesh.grain);
    for (const { mesh, by = [0, 0, 0] } of meshes) {
        const first = points.length;
        mesh.points.forEach((p, i) => {
            const moved: V3 = [p[0] + by[0], p[1] + by[1], p[2] + by[2]];
            points.push(moved);
            if (any) grain.push(mesh.grain?.[i] ?? moved);
        });
        for (const face of mesh.faces) faces.push(face.map((corner) => corner + first));
    }
    return any ? { points, faces, smooth, grain } : { points, faces, smooth };
}

/** A hole in the table, from its least corner to its greatest across and along: a pit for a lift's skirt. */
export interface Hole {
    x: [number, number];
    z: [number, number];
}

/**
 * The table's top, `reach` each way from the middle and `thick` deep under the ground, as boxes that
 * leave out every hole: the places across and along where any hole begins or ends cut it into a grid,
 * and each row of the grid's cells that are not in a hole is one box. A pit's walls are the boxes'
 * sides.
 */
export function tableMesh(reach: number, thick: number, holes: Hole[]): Mesh {
    const cuts = (pick: (hole: Hole) => [number, number]) => [...new Set([-reach, reach, ...holes.flatMap((hole) => pick(hole).map((v) => Math.max(-reach, Math.min(reach, v))))])].sort((a, b) => a - b);
    const [xs, zs] = [cuts((hole) => hole.x), cuts((hole) => hole.z)];
    const inHole = (x: number, z: number) => holes.some((hole) => x > hole.x[0] && x < hole.x[1] && z > hole.z[0] && z < hole.z[1]);
    const boxes: { mesh: Mesh }[] = [];
    for (let j = 0; j + 1 < zs.length; j++) {
        const [z0, z1] = [zs[j]!, zs[j + 1]!];
        let from: number | undefined;
        for (let i = 0; i <= xs.length - 1; i++) {
            const open = i + 1 < xs.length && !inHole((xs[i]! + xs[i + 1]!) / 2, (z0 + z1) / 2);
            if (open && from === undefined) from = xs[i]!;
            if (!open && from !== undefined) {
                const to = xs[i]!;
                boxes.push({ mesh: grainedBox([(to - from) / 2, thick / 2, (z1 - z0) / 2], [(from + to) / 2, -thick / 2, (z0 + z1) / 2]) });
                from = undefined;
            }
        }
    }
    return merged(boxes, false)!;
}
