// The 3D part of Mote: solids made of flat faces, turned and drawn on an
// ordinary 2D canvas. There is no WebGL here. Each face is turned, the ones
// facing away are dropped, the rest are drawn back to front and shaded by how
// squarely they face the light.

export type V3 = [number, number, number];
/** Three rows of three: which way a solid is turned. */
export type Turn = [V3, V3, V3];

export interface Mesh {
    points: V3[];
    /** Each face as the numbers of its points, counter-clockwise seen from outside. */
    faces: number[][];
}

export const upright = (): Turn => [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
];

const times = (a: Turn, b: Turn): Turn =>
    a.map((row) => [0, 1, 2].map((column) => row[0] * b[0][column]! + row[1] * b[1][column]! + row[2] * b[2][column]!)) as Turn;

/** `turn`, then turned further by these angles about the screen's own axes: `across` about the upright one, `over` about the level one. */
export function turned(turn: Turn, across: number, over: number): Turn {
    const [ca, sa, co, so] = [Math.cos(across), Math.sin(across), Math.cos(over), Math.sin(over)];
    const about: Turn = [
        [ca, 0, sa],
        [so * sa, co, -so * ca],
        [-co * sa, so, co * ca],
    ];
    return times(about, turn);
}

export const apply = (turn: Turn, [x, y, z]: V3): V3 => [
    turn[0][0] * x + turn[0][1] * y + turn[0][2] * z,
    turn[1][0] * x + turn[1][1] * y + turn[1][2] * z,
    turn[2][0] * x + turn[2][1] * y + turn[2][2] * z,
];

export const plus = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const minus = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scaled = (a: V3, by: number): V3 => [a[0] * by, a[1] * by, a[2] * by];
export const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]) || 1;
export const unit = (a: V3): V3 => [a[0] / length(a), a[1] / length(a), a[2] / length(a)];

/** `turn`, turned further by a small rotation given as an axis whose length is the angle. */
export function spun(turn: Turn, [x, y, z]: V3): Turn {
    const angle = Math.hypot(x, y, z);
    if (angle < 1e-9) return turn;
    const [ux, uy, uz] = [x / angle, y / angle, z / angle];
    const [c, s, k] = [Math.cos(angle), Math.sin(angle), 1 - Math.cos(angle)];
    return times(
        [
            [c + ux * ux * k, ux * uy * k - uz * s, ux * uz * k + uy * s],
            [uy * ux * k + uz * s, c + uy * uy * k, uy * uz * k - ux * s],
            [uz * ux * k - uy * s, uz * uy * k + ux * s, c + uz * uz * k],
        ],
        turn,
    );
}

/** The outward direction of each face of a solid, before it is turned. */
export const normals = (mesh: Mesh): V3[] => mesh.faces.map((face) => unit(cross(minus(mesh.points[face[1]!]!, mesh.points[face[0]!]!), minus(mesh.points[face[2]!]!, mesh.points[face[0]!]!))));

/** Where the light comes from: up, to the left, and from the viewer's side. */
const LIGHT = unit([-0.5, 0.8, 0.9]);

export interface Look {
    /** The center on the canvas, and how many pixels one unit is. */
    x: number;
    y: number;
    size: number;
    /** How far away the eye is, in units. Nearer exaggerates the perspective. */
    distance?: number;
    /** The fill for a face, given how brightly it is lit from 0 to 1. */
    fill(light: number, face: number): string;
    edge?: string;
    /** Where the solid's middle is, in units, and how the whole scene is turned to be looked at. */
    at?: V3;
    view?: Turn;
    /** Draw faces that point away too: for a flat piece seen from either side. */
    both?: boolean;
    /** What to write on a face, and in what color and face. */
    label?(face: number): string;
    ink?: string;
    font?: string;
}

/** Draws a solid, turned by `turn`. */
export function paint(ctx: CanvasRenderingContext2D, mesh: Mesh, turn: Turn, look: Look): void {
    const distance = look.distance ?? 5;
    const placed = mesh.points.map((point) => plus(apply(turn, point), look.at ?? [0, 0, 0]));
    const points = look.view ? placed.map((point) => apply(look.view!, point)) : placed;
    const flat = points.map(([x, y, z]): [number, number] => {
        const near = distance / (distance - z);
        return [look.x + x * near * look.size, look.y - y * near * look.size];
    });
    const faces = mesh.faces
        .map((corners, number) => {
            const [a, b, c] = [points[corners[0]!]!, points[corners[1]!]!, points[corners[2]!]!];
            const normal = unit(cross(minus(b, a), minus(c, a)));
            const middle = corners.reduce((sum, corner) => sum + points[corner]![2], 0) / corners.length;
            // Facing the eye if its normal points more toward the eye than away, judged from the face itself.
            const toward = normal[0] * -a[0] + normal[1] * -a[1] + normal[2] * (distance - a[2]);
            return { corners, number, normal, middle, toward };
        })
        .filter((face) => look.both || face.toward > 0)
        .sort((a, b) => a.middle - b.middle);
    ctx.lineJoin = "round";
    for (const face of faces) {
        const light = Math.max(0, face.normal[0] * LIGHT[0] + face.normal[1] * LIGHT[1] + face.normal[2] * LIGHT[2]);
        ctx.beginPath();
        face.corners.forEach((corner, index) => (index ? ctx.lineTo(flat[corner]![0], flat[corner]![1]) : ctx.moveTo(flat[corner]![0], flat[corner]![1])));
        ctx.closePath();
        ctx.fillStyle = look.fill(light, face.number);
        ctx.fill();
        if (look.edge) {
            ctx.strokeStyle = look.edge;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
        const words = face.toward > 0 ? look.label?.(face.number) : undefined;
        if (words) {
            // Written at the middle of the face, smaller the more the face is turned away.
            const middle = face.corners.reduce((sum, corner) => [sum[0] + flat[corner]![0], sum[1] + flat[corner]![1]], [0, 0]).map((sum) => sum / face.corners.length);
            const facing = Math.min(1, face.toward / (distance * 1.02));
            ctx.font = `600 ${Math.max(6, look.size * 0.5 * (0.45 + 0.55 * facing))}px ${look.font ?? "serif"}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = look.ink ?? "#000";
            ctx.globalAlpha = Math.max(0.15, facing);
            ctx.fillText(words, middle[0]!, middle[1]!);
            ctx.globalAlpha = 1;
        }
    }
}

/** How far from the eye a solid's middle is once the scene is turned: larger is nearer. For drawing several back to front. */
export const nearness = (at: V3, view?: Turn) => (view ? apply(view, at) : at)[2];

/** A solid from its corners and the outward direction of each face: each face is the corners furthest that way, in order round it. */
export function faced(points: V3[], directions: V3[], each: number): Mesh {
    return outward({
        points,
        faces: directions.map((direction) => {
            const out = unit(direction);
            const corners = points.map((_, index) => index).sort((a, b) => dot3(points[b]!, out) - dot3(points[a]!, out)).slice(0, each);
            const middle = scaled(corners.reduce((sum, corner) => plus(sum, points[corner]!), [0, 0, 0] as V3), 1 / each);
            const across = unit(minus(points[corners[0]!]!, middle));
            const up = cross(out, across);
            return corners.sort((a, b) => Math.atan2(dot3(minus(points[a]!, middle), up), dot3(minus(points[a]!, middle), across)) - Math.atan2(dot3(minus(points[b]!, middle), up), dot3(minus(points[b]!, middle), across)));
        }),
    });
}

/** A flat four-cornered piece, for a floor, a wall or a ramp. */
export const sheet = (a: V3, b: V3, c: V3, d: V3): Mesh => ({ points: [a, b, c, d], faces: [[0, 1, 2, 3]] });

/** Makes every face wind counter-clockwise seen from outside, for a solid that bulges everywhere and sits around the origin. */
function outward(mesh: Mesh): Mesh {
    return {
        points: mesh.points,
        faces: mesh.faces.map((face) => {
            const [a, b, c] = [mesh.points[face[0]!]!, mesh.points[face[1]!]!, mesh.points[face[2]!]!];
            const normal = cross(minus(b, a), minus(c, a));
            return normal[0] * a[0] + normal[1] * a[1] + normal[2] * a[2] < 0 ? face.toReversed() : face;
        }),
    };
}

export const cube = (): Mesh =>
    outward({
        points: [
            [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
            [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
        ],
        faces: [
            [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4],
            [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4],
        ],
    });

export const pyramid = (): Mesh => {
    const r = 1.35;
    return outward({
        points: [[r, r, r], [r, -r, -r], [-r, r, -r], [-r, -r, r]].map(([x, y, z]) => [x! * 0.72, y! * 0.72, z! * 0.72] as V3),
        faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
    });
};

export const diamond = (): Mesh => {
    const r = 1.45;
    return outward({
        points: [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]],
        faces: [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]],
    });
};

/** Twenty triangles. */
export const twenty = (): Mesh => {
    const g = (1 + Math.sqrt(5)) / 2;
    const s = 1.45 / Math.hypot(1, g);
    const points = ([[-1, g, 0], [1, g, 0], [-1, -g, 0], [1, -g, 0], [0, -1, g], [0, 1, g], [0, -1, -g], [0, 1, -g], [g, 0, -1], [g, 0, 1], [-g, 0, -1], [-g, 0, 1]] as V3[]).map(([x, y, z]): V3 => [x * s, y * s, z * s]);
    return outward({
        points,
        faces: [
            [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
            [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
        ],
    });
};

/** Twelve five-sided faces. */
export const twelve = (): Mesh => {
    const g = (1 + Math.sqrt(5)) / 2;
    const s = 0.82;
    const points: V3[] = [];
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) points.push([x * s, y * s, z * s]);
    for (const a of [-1, 1]) for (const b of [-1, 1]) points.push([0, (a / g) * s, b * g * s], [(a / g) * s, b * g * s, 0], [a * g * s, 0, (b / g) * s]);
    const directions: V3[] = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) directions.push([0, a * g, b], [a, 0, b * g], [a * g, b, 0]);
    return faced(points, directions, 5);
};

/** Ten kite-shaped faces: the ten-sided die. */
export const ten = (): Mesh => {
    const tall = 1.35;
    const c = Math.cos(Math.PI / 5);
    // How far the ring of corners zigzags, chosen so that each kite is flat.
    const zig = (tall * (1 - c)) / (1 + c);
    const ring = Array.from({ length: 10 }, (_, index): V3 => [Math.cos((index * Math.PI) / 5), index % 2 ? -zig : zig, Math.sin((index * Math.PI) / 5)]);
    const points: V3[] = [[0, tall, 0], [0, -tall, 0], ...ring];
    const at = (index: number) => 2 + (index % 10);
    return outward({
        points,
        faces: [0, 1, 2, 3, 4].flatMap((kite) => [
            [0, at(kite * 2), at(kite * 2 + 1), at(kite * 2 + 2)],
            [1, at(kite * 2 + 1), at(kite * 2 + 2), at(kite * 2 + 3)],
        ]),
    });
};
