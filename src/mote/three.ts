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

const apply = (turn: Turn, [x, y, z]: V3): V3 => [
    turn[0][0] * x + turn[0][1] * y + turn[0][2] * z,
    turn[1][0] * x + turn[1][1] * y + turn[1][2] * z,
    turn[2][0] * x + turn[2][1] * y + turn[2][2] * z,
];

const minus = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: V3) => Math.hypot(a[0], a[1], a[2]) || 1;
const unit = (a: V3): V3 => [a[0] / length(a), a[1] / length(a), a[2] / length(a)];

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
}

/** Draws a solid, turned by `turn`. */
export function paint(ctx: CanvasRenderingContext2D, mesh: Mesh, turn: Turn, look: Look): void {
    const distance = look.distance ?? 5;
    const points = mesh.points.map((point) => apply(turn, point));
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
        .filter((face) => face.toward > 0)
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
    }
}

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
