// Perspective's arithmetic: the plane-to-plane maps (homographies) a picture is straightened by. A map is
// nine numbers, row by row, taking a place (x, y) to ((a x + b y + c) / w, (d x + e y + f) / w) with
// w = g x + h y + i. Four places and where they go fix one (`quadToQuad`, by Heckbert's closed form from
// the unit square); it is turned back (`invert`), put after another (`multiply`), and its stretch at a
// place read (`stretch`). A camera turned about its own middle gives one too (`tilted`), which is how the
// two keystone dials work: the picture as if the camera had been tilted up or down, or turned left or
// right, by some degrees. `ratioOf` guesses the true proportions of a rectangle seen in perspective from
// its four corners (Zhang and He's method, the camera's middle taken to be the picture's).
//
//   const map = quadToQuad(corners, [{ x: 0, y: 0 }, { x: 210, y: 0 }, { x: 210, y: 297 }, { x: 0, y: 297 }]);
//   const there = apply(map, { x: 120, y: 80 });

/** A place, in pixels. */
export interface Spot {
    x: number;
    y: number;
}

/** A homography: nine numbers, row by row. */
export type Matrix = [number, number, number, number, number, number, number, number, number];

/** The map that changes nothing. */
export const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Where a map takes a place. */
export function apply(m: Matrix, point: Spot): Spot {
    const w = m[6] * point.x + m[7] * point.y + m[8];
    return { x: (m[0] * point.x + m[1] * point.y + m[2]) / w, y: (m[3] * point.x + m[4] * point.y + m[5]) / w };
}

/** The bottom of a map's fraction at a place: above zero wherever the place lands in front of the camera. */
export const depth = (m: Matrix, point: Spot): number => m[6] * point.x + m[7] * point.y + m[8];

/** The map that does `second` after `first`. */
export function multiply(second: Matrix, first: Matrix): Matrix {
    const out = new Array(9).fill(0) as Matrix;
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) out[row * 3 + column] = second[row * 3]! * first[column]! + second[row * 3 + 1]! * first[3 + column]! + second[row * 3 + 2]! * first[6 + column]!;
    return out;
}

/** A map scaled so that its last number is one where it can be, which changes nothing it does. */
export function normal(m: Matrix): Matrix {
    const scale = Math.abs(m[8]) > 1e-12 ? m[8] : Math.hypot(...m) || 1;
    return m.map((value) => value / scale) as Matrix;
}

/** The map that undoes another, or undefined when it flattens the plane to a line. */
export function invert(m: Matrix): Matrix | undefined {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const determinant = a * A + b * B + c * C;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-300) return undefined;
    return normal([A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((value) => value / determinant) as Matrix);
}

/** The map from the unit square's corners (0,0), (1,0), (1,1), (0,1) to four places in that order, by Heckbert's closed form; undefined when three of them lie on a line. */
export function squareToQuad(quad: Spot[]): Matrix | undefined {
    const [p0, p1, p2, p3] = quad as [Spot, Spot, Spot, Spot];
    const sx = p0.x - p1.x + p2.x - p3.x;
    const sy = p0.y - p1.y + p2.y - p3.y;
    if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return [p1.x - p0.x, p3.x - p0.x, p0.x, p1.y - p0.y, p3.y - p0.y, p0.y, 0, 0, 1];
    const dx1 = p1.x - p2.x;
    const dx2 = p3.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dy2 = p3.y - p2.y;
    const bottom = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(bottom) < 1e-12) return undefined;
    const g = (sx * dy2 - dx2 * sy) / bottom;
    const h = (dx1 * sy - sx * dy1) / bottom;
    return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}

/** The map taking four places to four others, in order; undefined when either four has three on a line. */
export function quadToQuad(from: Spot[], to: Spot[]): Matrix | undefined {
    const a = squareToQuad(from);
    const b = squareToQuad(to);
    const back = a && invert(a);
    return back && b ? normal(multiply(b, back)) : undefined;
}

/** True when four places, in order, go round a shape with no corner bent inward and no sides crossing. */
export function convex(quad: Spot[]): boolean {
    let sign = 0;
    for (let at = 0; at < 4; at++) {
        const a = quad[at]!;
        const b = quad[(at + 1) % 4]!;
        const c = quad[(at + 2) % 4]!;
        const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (Math.abs(turn) < 1e-9) return false;
        if (sign && Math.sign(turn) !== sign) return false;
        sign = Math.sign(turn);
    }
    return true;
}

/** How much a map stretches the plane about a place, each way: the lengths of where a step across and a step down go (above one, it enlarges). */
export function stretch(m: Matrix, point: Spot): { across: number; down: number; area: number } {
    const w = depth(m, point);
    const there = apply(m, point);
    // the derivative of the fraction: (row - there times the bottom's row) over the bottom
    const ax = (m[0] - there.x * m[6]) / w;
    const ay = (m[3] - there.y * m[6]) / w;
    const bx = (m[1] - there.x * m[7]) / w;
    const by = (m[4] - there.y * m[7]) / w;
    return { across: Math.hypot(ax, ay), down: Math.hypot(bx, by), area: Math.abs(ax * by - ay * bx) };
}

/** The focal length taken for a picture when nothing says what it was, in pixels: its longer side, which is a lens of about 36 mm on a full frame. */
export const assumedFocal = (size: { width: number; height: number }) => Math.max(size.width, size.height);

/**
 * The map of a picture seen by a camera turned about its own middle: tilted up by `vertical` degrees (the
 * top drawn away, so lines that met above the picture stand straight) and turned right by `horizontal`
 * degrees, about the picture's middle, with a focal length in pixels. It is `K R K⁻¹`, so a level camera
 * (both zero) changes nothing.
 */
export function tilted(vertical: number, horizontal: number, size: { width: number; height: number }, focal = assumedFocal(size)): Matrix {
    if (!vertical && !horizontal) return [...IDENTITY];
    const cx = size.width / 2;
    const cy = size.height / 2;
    const t = (vertical * Math.PI) / 180;
    const p = (horizontal * Math.PI) / 180;
    // a turn about the across axis by t, then about the down axis by p
    const rx: Matrix = [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
    const ry: Matrix = [Math.cos(p), 0, Math.sin(p), 0, 1, 0, -Math.sin(p), 0, Math.cos(p)];
    const k: Matrix = [focal, 0, cx, 0, focal, cy, 0, 0, 1];
    const back: Matrix = [1 / focal, 0, -cx / focal, 0, 1 / focal, -cy / focal, 0, 0, 1];
    return normal(multiply(k, multiply(ry, multiply(rx, back))));
}

/** A map moved and scaled after, so that the picture's middle stays where it is and the plane keeps its size there: how a straightened picture is laid back over the original's pixels. */
export function keepMiddle(m: Matrix, size: { width: number; height: number }): Matrix {
    const middle = { x: size.width / 2, y: size.height / 2 };
    const there = apply(m, middle);
    const scale = 1 / Math.sqrt(Math.max(1e-12, stretch(m, middle).area));
    const after: Matrix = [scale, 0, middle.x - scale * there.x, 0, scale, middle.y - scale * there.y, 0, 0, 1];
    return normal(multiply(after, m));
}

const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/**
 * A guess at the true width over height of a rectangle seen in perspective, from its four corners in
 * order round it from the top left, by Zhang and He's method ("Whiteboard scanning and image
 * enhancement", 2007): the camera's focal length is found from the corners, its middle taken to be the
 * picture's and its pixels square. When one pair of sides is parallel the focal length cannot be read, and
 * the one taken for a picture (`assumedFocal`) is used; seen straight on, it is the plain ratio of the
 * sides' average lengths.
 */
export function ratioOf(quad: Spot[], size: { width: number; height: number }): number {
    const [tl, tr, br, bl] = quad as [Spot, Spot, Spot, Spot];
    const long = (a: Spot, b: Spot) => Math.hypot(b.x - a.x, b.y - a.y);
    const plain = (long(tl, tr) + long(bl, br)) / Math.max(1e-9, long(tl, bl) + long(tr, br));
    const cx = size.width / 2;
    const cy = size.height / 2;
    // the paper's m1 to m4: top left, top right, bottom left, bottom right, about the picture's middle
    const scale = Math.max(size.width, size.height);
    const m = [tl, tr, bl, br].map((point) => [(point.x - cx) / scale, (point.y - cy) / scale, 1]) as [number[], number[], number[], number[]];
    const [m1, m2, m3, m4] = m;
    const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
    const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
    if (!Number.isFinite(k2) || !Number.isFinite(k3)) return plain;
    const n2 = [k2 * m2[0]! - m1[0]!, k2 * m2[1]! - m1[1]!, k2 * m2[2]! - m1[2]!];
    const n3 = [k3 * m3[0]! - m1[0]!, k3 * m3[1]! - m1[1]!, k3 * m3[2]! - m1[2]!];
    // both pairs of sides parallel: seen straight on, and the plain ratio is right
    if (Math.abs(n2[2]!) < 1e-3 && Math.abs(n3[2]!) < 1e-3) return plain;
    // one pair parallel: the focal length cannot be read from the corners, so the one taken for a picture is used
    let f2 = Math.abs(n2[2]!) < 1e-3 || Math.abs(n3[2]!) < 1e-3 ? (assumedFocal(size) / scale) ** 2 : -(n2[0]! * n3[0]! + n2[1]! * n3[1]!) / (n2[2]! * n3[2]!);
    // a focal length from a fifth of the picture's longer side to twenty times it, as a camera's are, else the one taken
    if (!(f2 > 0.04 && f2 < 400)) f2 = (assumedFocal(size) / scale) ** 2;
    const ratio = Math.sqrt((n2[0]! ** 2 + n2[1]! ** 2 + f2 * n2[2]! ** 2) / (n3[0]! ** 2 + n3[1]! ** 2 + f2 * n3[2]! ** 2));
    return Number.isFinite(ratio) && ratio > 0 ? ratio : plain;
}

/** The weights by which a four-cornered shape is drawn in true perspective on the card: each corner's bottom of the fraction, from the map of the unit square to it. The corners and the weights are in the order the card takes them, top left, top right, bottom left, bottom right; all ones for a parallelogram. */
export function cornerDepths(quad: [Spot, Spot, Spot, Spot]): [number, number, number, number] {
    const map = squareToQuad([quad[0], quad[1], quad[3], quad[2]]);
    if (!map) return [1, 1, 1, 1];
    const at = (u: number, v: number) => map[6] * u + map[7] * v + map[8];
    const depths = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)] as [number, number, number, number];
    return depths.every((each) => each > 1e-9) ? depths : [1, 1, 1, 1];
}
