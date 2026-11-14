// The marble run's moving and sounding pieces, worked out in their own place as pieces.ts works out the
// rest: a gate a marble opens, an alternating switch, a seesaw that tips when enough marbles are in it, a
// trapdoor that opens under enough weight, a spinner the marbles turn, a lift and a chain hoist that carry
// marbles up, and a chime bar, a bell and a drum that marbles strike. Each is track (pieces.ts' lengths),
// fixed boxes, and either solids that move (on a hinge, or driven) or a solid that sounds. table.ts makes
// them in Mote's physics; marbles.ts draws them.
//
//   const made = designPart("w", []);     // the switch: its joints, track, walls and its flipper on a hinge
//
// The numbers are the piece's own place, as in pieces.ts: its first joint at (0, 0, 4) pointing back along
// -x, the piece going on toward +x, a cell 8 cm and a level 2 cm, a marble of 0.8 cm sitting 0.7 below the
// line its track is made along. Every one of them is the same mirrored, so none is ever mirrored. Only the
// sine and cosine of track.ts are used, so every piece is the same to the bit everywhere.

import type { Strike } from "../mote/sound";
import { block, type Mesh, type V3 } from "../mote/solids";
import { cosine, sine } from "../mote/track";
import type { Box, Joint, Length } from "./pieces";

/** The families of moving and sounding pieces, by their letter. */
export const PARTS = { g: "gate", w: "switch", e: "seesaw", j: "trapdoor", o: "spinner", u: "lift", y: "hoist", m: "chime", n: "bell", q: "drum" } as const;

/** A moving or sounding family's letter. */
export type PartFamily = keyof typeof PARTS;

/** Whether a family is one of these. */
export const isPart = (family: string): family is PartFamily => family in PARTS;

/** The least and most of each family's own numbers: a lift's height in levels, a hoist's length in cells, how many marbles tip a seesaw, a spinner's arms, a chime bar's note. */
export const PART_SIZES: Record<PartFamily, [least: number, most: number][]> = {
    g: [],
    w: [],
    e: [[1, 4]],
    j: [],
    o: [[3, 6]],
    u: [[4, 24]],
    y: [[3, 6]],
    m: [[0, 14]],
    n: [],
    q: [],
};

/** The notes a chime bar can be tuned to: two octaves of C major, from C5 to C7, in hertz, equal tempered from A4 at 440. */
export const NOTES: number[] = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24].map((step) => 440 * 2 ** ((step + 3) / 12));

/** The names of those notes, for a person reading them. */
export const NOTE_NAMES = ["C5", "D5", "E5", "F5", "G5", "A5", "B5", "C6", "D6", "E6", "F6", "G6", "A6", "B6", "C7"];

/** A chime bar's length for a note, in cm: a bar free at both ends sounds at a pitch that goes as one over its length squared, so the length goes as one over the root of the pitch; C5 is 7 cm, C7 3.5. */
export const barLength = (note: number): number => 7 * Math.sqrt(NOTES[0]! / NOTES[note]!);

/** A solid of a moving part, as it is at angle naught: a box, its middle, and its density. */
export interface Body {
    half: V3;
    at: V3;
    density: number;
    /** Turned by this many radians from lying as the box is: about the hinge's line (a spinner's arms), or for a driven part about the line across the piece through its own middle (a lift's sloping floor). */
    turn?: number;
    /** Leaning this many radians about the line along the piece through its own middle, before any turn: one side of a shallow V. */
    lean?: number;
}

/** A part that moves: on a hinge, or driven (a lift's car, a hoist's paddles). */
export type Moving =
    | { kind: "hinge"; sound: Strike; bodies: Body[]; at: V3; axis: V3; low: number; high: number; spring: number; rest: number; friction: number; start: number }
    | { kind: "lift"; sound: Strike; bodies: Body[]; rise: number; speed: number; ease: number; waits: [bottom: number, top: number] }
    | { kind: "hoist"; sound: Strike; bodies: Body[]; loop: Loop; speed: number; count: number };

/** A hoist's chain: the middles of its two sprockets, their radius, and how far its paddles stand out from it. */
export interface Loop {
    bottom: V3;
    top: V3;
    radius: number;
}

/** A fixed solid a marble strikes and hears: a chime bar, a bell or a drum, as a mesh about its middle, tilted about the piece's across line by `tilt`. */
export interface Struck {
    mesh: Mesh;
    at: V3;
    tilt: number;
    sound: Strike;
    pitch?: number;
}

/** What a moving or sounding piece is, in its own place: as pieces.ts' design gives, and more. */
export interface PartDesign {
    joints: Joint[];
    lengths: Length[];
    boxes: Box[];
    /** Walls a marble meets that are drawn as glass, so that the part inside them can be seen working. */
    panes?: Box[];
    stands: Box[];
    holds: V3[];
    low: number;
    moving?: Moving;
    struck?: Struck;
    /** Room the moving part needs kept clear as it moves, which nothing else may take. */
    clear: Box[];
    /** Where the knob that sets its number is, for those that have one. */
    knob?: V3;
}

const J0: Joint = { at: [0, 0, 4], way: [-1, 0, 0], kind: "groove" };
const joint = (at: V3, way: V3): Joint => ({ at, way, kind: "groove" });
/** A smooth length of grooved track through points, level at both ends unless said, as pieces.ts makes its own. */
const groove = (points: V3[], joints: Length["joints"], start: V3 = [1, 0, 0], end: V3 = [1, 0, 0]): Length => ({ section: "block", path: { points, start, end }, level: true, joints });
/** A box from its least corner to its greatest. */
const span = (from: V3, to: V3): Box => ({ at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2], half: [(to[0] - from[0]) / 2, (to[1] - from[1]) / 2, (to[2] - from[2]) / 2] });
/** A body from its least corner to its greatest, of a density. */
const body = (from: V3, to: V3, density: number, turn?: number): Body => ({ ...span(from, to), density, turn });

/**
 * A floor from `from` to `to` along the piece, `wide` across (1.9 cm unless said), as a shallow V of two planks 3 mm thick
 * leaning 12 degrees up from its middle line, whose top is at `top`: a marble rests in it on the two
 * planks alone, centred, and touches no wall beside it.
 */
function vee(from: number, to: number, top: number, density: number, wide = 1.9): Body[] {
    const lean = (12 * Math.PI) / 180;
    const [c, s] = [cosine(lean), sine(lean)];
    const half = wide / 2 / c / 2;
    return [-1, 1].map((side) => ({
        half: [(to - from) / 2, 0.15, half] as V3,
        at: [(from + to) / 2, top + half * s - 0.15 * c, 4 + side * (half * c + 0.15 * s)] as V3,
        density,
        lean: -side * lean,
    }));
}

/**
 * The chute the sounding pieces share: a short groove, then a glass tube that turns straight down and
 * ends 3.4 cm below the joint, so that a marble leaves it falling straight down, at much the same speed
 * every time, onto what it strikes.
 */
function chute(): Length[] {
    const curl: V3[] = [];
    for (let i = 0; i <= 8; i++) {
        const angle = Math.PI / 2 - (Math.PI / 2) * (i / 8);
        curl.push([3 + 2 * cosine(angle), -2 + 2 * sine(angle), 4]);
    }
    curl.push([5, -3.4, 4]);
    return [groove([[0, 0, 4], [3, 0, 4]], [0, undefined]), { section: "tube", path: { points: curl, start: [1, 0, 0], end: [0, -1, 0] }, level: false, joints: [undefined, undefined] }];
}

/** A prism of `sides` about an upright axis through its middle, `radius` round and `high` tall: a drum. */
function prism(radius: number, high: number, sides: number): Mesh {
    return ringed([[radius, -high / 2], [radius, high / 2]], sides, true);
}

/**
 * A solid of rings about an upright axis, each `[radius, height]`, closed at both ends, `sides` round:
 * a bell's shape, or a drum's. `flat` closes the top with one face rather than a point.
 */
function ringed(rings: [number, number][], sides: number, flat = true): Mesh {
    const points: V3[] = [];
    for (const [radius, high] of rings) {
        for (let k = 0; k < sides; k++) {
            const angle = (2 * Math.PI * k) / sides;
            points.push([radius * cosine(angle), high, radius * sine(angle)]);
        }
    }
    const faces: number[][] = [];
    for (let r = 0; r + 1 < rings.length; r++) {
        for (let k = 0; k < sides; k++) {
            const [a, b] = [r * sides + k, r * sides + ((k + 1) % sides)];
            faces.push([a, a + sides, b + sides, b]);
        }
    }
    // the bottom face, wound to face down, and the top, to face up
    faces.push(Array.from({ length: sides }, (_, k) => k));
    if (flat) faces.push(Array.from({ length: sides }, (_, k) => (rings.length - 1) * sides + sides - 1 - k));
    return { points, faces };
}

/** The bell's shape: a mouth 2.2 cm round, narrowing to a crown 3 cm up, as a solid that bulges everywhere. */
export const BELL: [number, number][] = [[2.2, 0], [2.05, 0.8], [1.55, 2], [0.95, 2.7], [0.45, 3]];

/**
 * The seesaw's counterweights, a pair either side of its tray behind its pivot on arms rising at 60
 * degrees, as tall as the marbles it holds before it tips need: worked out so that, at its resting
 * tilt, they turn it back by half way between what `count - 1` marbles lying against its end wall turn
 * it forward and what `count` do, the tray's own weight counted, so that `count` tip it and one fewer
 * never do. As it tips their arms turn toward upright, so they pull it back less: it tips all the way
 * at once and stays tipped until the marbles have rolled out. Their height, in cm.
 */
export function counterweight(count: number): number {
    const marbles = (n: number) => seesawArms().slice(0, n).reduce((sum, arm) => sum + arm * MARBLE_MASS, 0);
    const needed = (marbles(count - 1) + marbles(count)) / 2;
    // two blocks of steel 2.4 cm long and 1 cm across, `reach` from the pivot on arms rising at `rise`, turned by the resting tilt
    const out = SEESAW.reach * cosine(SEESAW.rise - SEESAW.rest);
    return (needed + seesawOwn()) / (2 * 2.4 * 1 * SEESAW.steel * out);
}

/** A marble's mass, in grams: glass, 0.8 cm round. */
const MARBLE_MASS = (4 / 3) * Math.PI * 0.8 ** 3 * 2.5;

/** How far out from the seesaw's pivot each marble lying against its end wall is, in a row: 7.2, 5.6, 4.0 and 2.4 cm. The wall is fixed, so tilting the tray does not move them. */
export const seesawArms = (): number[] => [0, 1, 2, 3].map((k) => SEESAW.wall - 0.8 - 1.6 * k - SEESAW.pivot[0]);

/** The tray's own turning push toward its end, at its resting tilt: each body's mass times how far its middle is out from the pivot, once turned. */
export function seesawOwn(): number {
    const [c, k] = [cosine(SEESAW.rest), sine(SEESAW.rest)];
    return seesawTray(0).reduce((sum, one) => sum + one.half[0] * one.half[1] * one.half[2] * 8 * one.density * ((one.at[0] - SEESAW.pivot[0]) * c - (one.at[1] - SEESAW.pivot[1]) * k), 0);
}

/** The seesaw's numbers: its pivot, under the middle of its tray; the inner face of its fixed end wall; how far out and how steeply up its weights' arms go; its resting and tipped tilts; and steel's density. */
export const SEESAW = { pivot: [13, -3.2, 4] as V3, wall: 21, reach: 5, rise: (65 * Math.PI) / 180, rest: -0.06, tipped: -0.35, steel: 7.8 };

/** The seesaw's tray at angle naught, without its weights: a floor that is a wide shallow V, which catches a marble that comes in rocking and lines the marbles up along its middle, two rails and a low lip at its back. */
function seesawTray(_count: number): Body[] {
    return [
        ...vee(4.5, 21.5, -3, 0.6, 3.4),
        body([4.5, -3, 2.0], [21.5, -1.8, 2.3], 0.6),
        body([4.5, -3, 5.7], [21.5, -1.8, 6.0], 0.6),
        body([4.5, -3, 2.3], [4.8, -2.2, 5.7], 0.6),
    ];
}

/**
 * The trapdoor's numbers. Marbles resting against its lip lie 6.6 and 5.0 cm from its hinge, so one
 * turns it by 6.6 m g and two by 11.6 m g. Its counterweights, beside it behind the hinge on arms
 * 3 cm long rising 10 degrees, hold it closed against its own weight and half way between those,
 * 9.1 m g. As it opens their arms turn toward upright, so they hold it less while the marbles still
 * press it open nearly as much: it opens all the way at once, and once the marbles are gone, with
 * nothing on it, they close it again.
 */
export const TRAPDOOR = { arms: [6.6, 5.0], hold: 9.1, reach: 3, rise: (10 * Math.PI) / 180 };

/** The switch's numbers: where its pivot is, below the joint, and how far it leans each way, in radians. */
export const SWITCH = { pivot: -5, lean: 0.45 };

/** The lift's numbers: its speed in cm/s, how long it eases in and out of that speed, and how long it waits at the bottom and the top, in seconds. */
export const LIFT = { speed: 20, ease: 0.12, waits: [0.45, 0.5] as [number, number] };
/** The hoist's numbers: its chain's speed in cm/s, and the spacing its paddles are given, about. */
export const HOIST = { speed: 16, spacing: 9 };

/** The smoothest ramp's integral, 0 before `c - w / 2` and x - c after `c + w / 2`: a line that turns from level to a slope of one, smoothly, over `w`. */
function turning(x: number, c: number, w: number): number {
    const u = (x - (c - w / 2)) / w;
    if (u <= 0) return 0;
    if (u >= 1) return x - c;
    return w * (u * u * u - (u * u * u * u) / 2);
}

/** The line of a hoist's groove of `cells` cells, at x: a short foot sloping down from its step, then up at 3 in 4 to its top, which turns level at its far joint. */
export function hoistLine(cells: number, x: number): number {
    const top = 6 * cells - 10;
    const c1 = 8 * cells - 2.5;
    const c0 = c1 - (top + 1.5) / 0.75;
    // the foot falls 0.4 cm from its step toward the incline, so that a marble rests where the paddles reach
    const foot = x < c0 ? -0.4 * Math.max(0, Math.min(1, (c0 - x) / (c0 - 3.4))) : 0;
    return -1.5 - foot + 0.75 * (turning(x, c0, 4) - turning(x, c1, 4));
}

/** A moving or sounding piece in its own place, by its family and its own numbers. */
export function designPart(family: PartFamily, sizes: number[]): PartDesign {
    const none = { boxes: [] as Box[], stands: [] as Box[], holds: [] as V3[], clear: [] as Box[] };
    switch (family) {
        case "g": {
            // a straight with a flap hung over it from a bar across, that swings forward to let a marble by and back to its stop
            const flap = body([3.875, -1, 3], [4.125, 3, 5], 0.5);
            return {
                ...none,
                joints: [J0, joint([8, 0, 4], [1, 0, 0])],
                lengths: [groove([[0, 0, 4], [8, 0, 4]], [0, 1])],
                stands: [span([3.6, 0, 1.6], [4.4, 3.6, 2.2]), span([3.6, 0, 5.8], [4.4, 3.6, 6.4]), span([3.7, 3.1, 1.6], [4.3, 3.6, 6.4])],
                moving: { kind: "hinge", sound: "wood", bodies: [flap], at: [4, 3, 4], axis: [0, 0, 1], low: 0, high: 1.45, spring: 0, rest: 0, friction: 0.4, start: 0 },
                clear: [span([0.5, -1.2, 2.6], [7.5, 3.2, 5.4])],
                low: -1,
            };
        }
        case "w": {
            // In along the row to a narrow chimney. A flipper stands in it on a line along the row: an
            // upright plate with two arms at its foot, one to each side, leaning against one stop or the
            // other and heavier above its pivot so that it stays where it is put. Leaning one way, the
            // plate turns a falling marble aside onto the arm that lies level on that side; the marble
            // rolls out along it, and its weight there throws the flipper over, so the arm tips down and
            // the marble rolls off it into the groove that side, while the other arm comes up level for
            // the next marble, which goes the other way. Out a row to each side.
            const [c, k] = [cosine(SWITCH.lean), sine(SWITCH.lean)];
            const [pivot, plate] = [SWITCH.pivot, body([1.9, SWITCH.pivot, 3.8], [6.1, SWITCH.pivot + 6, 4.2], 0.4)];
            // each arm 3.2 cm long from the foot, sloping down outward by the lean, so that leaning over it lies level
            const arm = (side: number): Body => ({ half: [2.1, 0.2, 1.6], at: [4, pivot - 1.6 * k - 0.2 * c, 4 + side * (1.6 * c - 0.2 * k)], density: 0.4, lean: side * SWITCH.lean });
            return {
                ...none,
                joints: [J0, joint([4, -10, -8], [0, 0, -1]), joint([4, -10, 16], [0, 0, 1])],
                lengths: [
                    groove([[0, 0, 4], [1.8, 0, 4]], [0, undefined]),
                    groove([[4, -8, 3.5], [4, -8.8, -1], [4, -10, -8]], [undefined, 1], [0, 0, -1], [0, 0, -1]),
                    groove([[4, -8, 4.5], [4, -8.8, 9], [4, -10, 16]], [undefined, 2], [0, 0, 1], [0, 0, 1]),
                ],
                // glass walls front and back of the chimney, and along both ways out, so that marbles that come together keep to them
                panes: [span([1.2, -7.8, 0.4], [1.8, -2.1, 7.6]), span([6.3, -7.8, 0.4], [6.9, 3, 7.6]), span([1.8, -11, -8], [2.1, -7, 0.4]), span([5.9, -11, -8], [6.2, -7, 0.4]), span([1.8, -11, 7.6], [2.1, -7, 16]), span([5.9, -11, 7.6], [6.2, -7, 16])],
                moving: { kind: "hinge", sound: "wood", bodies: [plate, arm(-1), arm(1)], at: [4, pivot, 4], axis: [1, 0, 0], low: -SWITCH.lean, high: SWITCH.lean, spring: 0, rest: 0, friction: 0.5, start: SWITCH.lean },
                clear: [span([1.8, -7.8, -0.4], [6.2, 1.2, 8.4])],
                holds: [],
                stands: [],
                low: -6,
            };
        }
        case "e": {
            // In along the row, dropping onto a tray on a pivot across its middle. The tray rests tilted a
            // little toward its far end, held up there by its counterweights against a stop, so marbles
            // roll to its fixed end wall and wait. Enough of them outweigh the counterweights: it tips, and
            // they roll out under the end wall onto the track below, and it swings back.
            const count = sizes[0]!;
            const high = counterweight(count);
            const [wx, wy] = [SEESAW.pivot[0] - SEESAW.reach * cosine(SEESAW.rise), SEESAW.pivot[1] + SEESAW.reach * sine(SEESAW.rise)];
            const weights = [0.8, 6.2].map((z) => body([wx - 1.2, wy - high / 2, z], [wx + 1.2, wy + high / 2, z + 1], SEESAW.steel));
            return {
                ...none,
                joints: [J0, joint([24, -8, 4], [1, 0, 0])],
                lengths: [groove([[0, 0, 4], [4, 0, 4]], [0, undefined]), groove([[20.6, -6.7, 4], [22, -7.7, 4], [23, -8, 4], [24, -8, 4]], [undefined, 1], [1, -0.6, 0], [1, 0, 0])],
                // its end wall, and walls along the track out, so that marbles tipped out together do not knock each other off it
                boxes: [span([SEESAW.wall, -3.3, 2.3], [SEESAW.wall + 0.6, -0.2, 5.7])],
                panes: [span([21.6, -8, 1.8], [24, -5.6, 2.1]), span([21.6, -8, 5.9], [24, -5.6, 6.2])],
                stands: [span([12.6, -8, 0.4], [13.4, -3.2, 0.8]), span([12.6, -8, 7.2], [13.4, -3.2, 7.6])],
                holds: [[13, -8, 0.6], [13, -8, 7.4]],
                moving: { kind: "hinge", sound: "wood", bodies: [...seesawTray(count), ...weights], at: SEESAW.pivot, axis: [0, 0, 1], low: SEESAW.tipped, high: SEESAW.rest, spring: 0, rest: 0, friction: 1.5, start: SEESAW.rest },
                clear: [span([4.3, -7.2, 1.9], [21.7, 1.2, 6.1]), span([wx - 2.4, wy - 2.5, 0.7], [wx + 2.4, wy + 2.5, 7.3])],
                knob: [wx, wy + high / 2 + 0.6, 1.3],
                low: -4,
            };
        }
        case "j": {
            // In along the row onto a flap hinged at its near end, between walls, up to a wall at its far
            // end. The flap has a low lip of its own just short of the wall, which marbles come to rest
            // against: so they rest on the flap alone, and the wall's friction cannot hold them up.
            // Counterweights hold the flap up against a stop with the push of a marble and a half lying
            // at the lip (TRAPDOOR): one waits there; a second opens it, it swings down, and both roll
            // over the lip and drop to the track below. The lip is low enough (4 mm) that a marble rolls
            // over it once the flap hangs steeper than 60 degrees.
            const flap = vee(4.1, 11.7, -1.55, 0.6);
            const lip = body([11.4, -1.55, 3.05], [11.7, -1.15, 4.95], 0.6);
            const mass = (4 / 3) * Math.PI * 0.8 ** 3 * 2.5;
            const turning = (one: Body) => one.half[0] * one.half[1] * one.half[2] * 8 * one.density * (one.at[0] - 4);
            // steel blocks a centimetre square, as long as they need to be, either side beyond the walls
            const weight = (flap.reduce((sum, one) => sum + turning(one), 0) + turning(lip) + mass * TRAPDOOR.hold) / (TRAPDOOR.reach * cosine(TRAPDOOR.rise));
            const long = weight / (2 * 7.8);
            const [wx, wy] = [4 - TRAPDOOR.reach * cosine(TRAPDOOR.rise), -1.75 + TRAPDOOR.reach * sine(TRAPDOOR.rise)];
            const weights = [0.6, 6.4].map((z) => body([wx - long / 2, wy - 0.5, z], [wx + long / 2, wy + 0.5, z + 1], 7.8));
            return {
                ...none,
                joints: [J0, joint([16, -12, 4], [1, 0, 0])],
                lengths: [groove([[0, 0, 4], [4, 0, 4]], [0, undefined]), groove([[4.5, -10, 4], [10, -10.9, 4], [16, -12, 4]], [undefined, 1])],
                boxes: [span([12, -1.7, 3.05], [12.4, 1, 4.95])],
                panes: [span([4, -1.6, 2.75], [12.4, 0.6, 3.05]), span([4, -1.6, 4.95], [12.4, 0.6, 5.25]), span([4.5, -12.2, 1.9], [16, -8.4, 2.2]), span([4.5, -12.2, 5.8], [16, -8.4, 6.1])],
                holds: [],
                moving: { kind: "hinge", sound: "wood", bodies: [...flap, lip, ...weights], at: [4, -1.75, 4], axis: [0, 0, 1], low: -1.25, high: 0, spring: 0, rest: 0, friction: 1, start: 0 },
                clear: [span([3.8, -9.5, 2.8], [12.3, -1.0, 5.2]), span([0.4, -2.5, 0.5], [4.2, 1.6, 1.7]), span([0.4, -2.5, 6.3], [4.2, 1.6, 7.5])],
                low: -7,
            };
        }
        case "o": {
            // In along the row to the top of a wheel of arms on a line across it, between two walls: a
            // marble lands on an arm, turns the wheel with its weight, and drops off below onto the track
            // out. The wheel turns freely and slows only a little.
            const arms = sizes[0]!;
            const centre: V3 = [8, -6.5, 4];
            const bodies = Array.from({ length: arms }, (_, k) => body([centre[0] + 0.6, centre[1] - 0.15, 2.9], [centre[0] + 5, centre[1] + 0.15, 5.1], 7.8, (2 * Math.PI * k) / arms + Math.PI / (2 * arms)));
            return {
                ...none,
                joints: [J0, joint([16, -14, 4], [1, 0, 0])],
                lengths: [groove([[0, 0, 4], [3, 0, 4]], [0, undefined]), groove([[2.4, -12.4, 4], [9, -13.1, 4], [16, -14, 4]], [undefined, 1])],
                panes: [span([2, -12.6, 2.5], [14.5, 0.2, 2.65]), span([2, -12.6, 5.35], [14.5, 0.2, 5.5]), span([2, -12.4, 2.65], [2.4, -2.2, 5.35]), span([13.6, -11.6, 2.65], [14, 0.2, 5.35])],
                holds: [],
                moving: { kind: "hinge", sound: "metal", bodies, at: centre, axis: [0, 0, 1], low: -Infinity, high: Infinity, spring: 0, rest: 0, friction: 0.4, start: 0 },
                clear: [span([2.8, -11.7, 2.7], [13.2, -1.3, 5.3])],
                knob: [centre[0], centre[1], 5.5 + 0.6 * (arms - 3) + 0.6],
                low: -8,
            };
        }
        case "u": {
            // In along the row to a car at the foot of a shaft, its floor sloping down to the shaft's back
            // wall. A marble rolls in and rests against the wall; the car rises at a steady speed; at the
            // top the wall ends and the marble rolls out over it onto the track out. A skirt under the car's
            // front closes the way in while it is away.
            const high = sizes[0]! * 2;
            const floor = body([6.1, -2.83, 2.75], [10.7, -2.33, 5.25], 2.7, -0.1);
            const skirt = body([5.65, -2.33 - high - 2, 2.75], [5.95, -2.2, 5.25], 2.7);
            const rise = high + 1.71;
            return {
                ...none,
                joints: [J0, joint([16, high, 4], [1, 0, 0])],
                lengths: [groove([[0, 0, 4], [5.6, -0.5, 4]], [0, undefined], [1, 0, 0], [1, -0.09, 0]), groove([[11.4, high + 0.5, 4], [16, high, 4]], [undefined, 1], [1, -0.11, 0], [1, 0, 0])],
                boxes: [span([10.8, -3, 2.75], [11.4, high - 1, 5.25])],
                panes: [span([5.8, -3, 2.45], [11.4, high + 1, 2.75]), span([5.8, -3, 5.25], [11.4, high + 1, 5.55]), span([5.4, 0, 2.75], [5.8, high + 1, 5.25]), span([0.3, -0.6, 2.25], [5.8, 1, 2.55]), span([0.3, -0.6, 5.45], [5.8, 1, 5.75])],
                holds: [[8.6, -3, 2.6], [8.6, -3, 5.4]],
                moving: { kind: "lift", sound: "metal", bodies: [floor, skirt], rise, speed: LIFT.speed, ease: LIFT.ease, waits: LIFT.waits },
                clear: [span([6, -3, 2.75], [10.8, high + 1, 5.25])],
                low: -2,
            };
        }
        case "y": {
            // In along the row, down a step onto the foot of a groove that climbs at 3 in 4 and turns level
            // at the far joint. Paddles on a chain under it come up through the foot, push each marble up
            // the climb, and go round and back down under it.
            const cells = sizes[0]!;
            const end = 8 * cells;
            const points: V3[] = [];
            for (let x = 3.4; x < end - 1e-9; x += 0.8) points.push([x, hoistLine(cells, x), 4]);
            points.push([end, hoistLine(cells, end), 4]);
            const c0 = 8 * cells - 2.5 - (6 * cells - 10 + 1.5) / 0.75;
            // the chain runs 1.8 cm under the climb's line, square to it, 3 mm under the groove, round sprockets 1.5 cm across where the climb begins and where it turns level
            const under = (x: number): V3 => [x + 0.6 * 3.3, -1.5 + 0.75 * (x - c0) - 0.8 * 3.3, 4];
            const loop: Loop = { bottom: under(5), top: under(8 * cells - 4.5), radius: 1.5 };
            const long = 2 * Math.hypot(loop.top[0] - loop.bottom[0], loop.top[1] - loop.bottom[1]) + 2 * Math.PI * loop.radius;
            const paddle = body([-0.2, 0, 2.9], [0.2, 1.6, 5.1], 7.8);
            return {
                ...none,
                joints: [J0, joint([end, 6 * cells - 10, 4], [1, 0, 0])],
                lengths: [groove([[0, 0, 4], [3.4, 0, 4]], [0, undefined]), groove(points, [undefined, 1])],
                boxes: [span([3.4, -3.4, 2.2], [3.8, -1.6, 5.8])],
                // glass walls along the foot, so that marbles that come in fast or together are kept in it
                panes: [span([0.3, -3.4, 1.9], [11, 1.4, 2.2]), span([0.3, -3.4, 5.8], [11, 1.4, 6.1])],
                stands: [span([loop.bottom[0] - 0.5, loop.bottom[1] - 0.5, 1.2], [loop.bottom[0] + 0.5, loop.bottom[1] + 0.5, 6.8]), span([loop.top[0] - 0.5, loop.top[1] - 0.5, 1.2], [loop.top[0] + 0.5, loop.top[1] + 0.5, 6.8])],
                holds: [[loop.bottom[0], loop.bottom[1] - 0.5, 1.5], [loop.top[0], loop.top[1] - 0.5, 1.5]],
                moving: { kind: "hoist", sound: "metal", bodies: [paddle], loop, speed: HOIST.speed, count: Math.max(2, Math.round(long / HOIST.spacing)) },
                clear: [span([3.8, loop.bottom[1] - 4, 2.8], [end - 0.5, hoistLine(cells, end) + 0.2, 5.2])],
                low: Math.floor((loop.bottom[1] - 4) / 2),
            };
        }
        case "m":
        case "n":
        case "q": {
            // the chute's tube drops each marble onto what it strikes, which turns it on toward the track out
            const struck: Struck =
                family === "m"
                    ? { mesh: block([1.2, 0.4, barLength(sizes[0]!) / 2]), at: [5, -5.35, 4], tilt: -0.25, sound: "chime", pitch: NOTES[sizes[0]!] }
                    : family === "n"
                      ? { mesh: ringed(BELL, 12), at: [3.8, -7.4, 4], tilt: 0, sound: "bell" }
                      : { mesh: prism(2.4, 2, 14), at: [4.6, -6.1, 4], tilt: -0.2, sound: "drum" };
            const down = family === "m" ? -6 : -8;
            const out = family === "m" ? 5.8 : family === "n" ? 6.4 : 7.1;
            const stands = family === "m" ? [span([3.6, -8, 4 - barLength(sizes[0]!) * 0.28 - 0.25], [4.4, -5.6, 4 - barLength(sizes[0]!) * 0.28 + 0.25]), span([3.6, -8, 4 + barLength(sizes[0]!) * 0.28 - 0.25], [4.4, -5.6, 4 + barLength(sizes[0]!) * 0.28 + 0.25])] : [];
            return {
                ...none,
                joints: [J0, joint([8, down, 4], [1, 0, 0])],
                lengths: [...chute(), groove([[out, down, 4], [8, down, 4]], [undefined, 1])],
                stands,
                holds: family === "m" ? stands.map((stand): V3 => [stand.at[0], stand.at[1] - stand.half[1], stand.at[2]]) : [[struck.at[0], struck.at[1] - (family === "q" ? 1.2 : 0), 4]],
                struck,
                clear: [],
                knob: family === "m" ? [5, -4.6, 4 + barLength(sizes[0]!) / 2 + 0.6] : undefined,
                low: family === "m" ? -5 : -6,
            };
        }
    }
}
