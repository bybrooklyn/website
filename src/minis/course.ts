// A marble course for looking at Mote's rolling: a ramp into a loop, a gutter on to a banked spiral,
// off its end into a funnel, and through the funnel's hole into a tray where the marbles come to
// rest and sleep. Kept apart from the drawing (rolling.ts) so that it can be run and tested.
//
//   const course = makeCourse();
//   course.release();                  // a marble at the top
//   course.space.step(dt);
//
// In centimetres, under real gravity, as Mote's marble space is.

import { MARBLE, marbleSpace, type Solid, type Space } from "../mote/space";
import { curve, gutter, helix, sweep, turned, type Piece } from "../mote/track";
import type { V3 } from "../mote/solids";

/** A marble's radius. */
export const RADIUS = 0.8;
/** How many marbles the course holds at once; past that the oldest in the tray is taken away. */
export const MOST = 40;

/** A fixed box of the tray, as `slab` takes it: its middle and half its size each way. */
export interface Box {
    at: V3;
    half: V3;
}

/** The course: its space, its pieces of track and the boxes of its tray, and what lets marbles go. */
export interface Course {
    space: Space;
    pieces: Piece[];
    boxes: Box[];
    marbles: Solid[];
    /** Lets a marble go at the top of the ramp, and gives it back. Past `MOST` the oldest marble is taken away first, and given to `gone`. */
    release(gone?: (marble: Solid) => void): Solid;
    /** Where a marble ends up: in the tray, or still on its way. */
    inTray(marble: Solid): boolean;
}

/** The course, with nothing on it yet. */
export function makeCourse(): Course {
    const space = marbleSpace();
    const wide = 1.6;
    const section = gutter(wide, Math.PI * 1.05, 0.25);
    const sink = wide - 0.125 - RADIUS;

    // A loop of radius 10 whose bottom is at the origin, coming out 4 to the side.
    const loop = helix([0, 10, 0], 10, 4, 1, { axis: [0, 0, 1], from: [0, -1, 0] });
    // The ramp in: the ball's middle starts 3.1 of the loop's radii above where it is at the bottom,
    // a little over the 2.7 it needs, for what rolling costs on the way.
    const rho = 10 + sink;
    const ramp = curve([[-75, 3.1 * rho, -1.5], [-38, 0.25 * 3.1 * rho, -0.6], [0, 0, 0]], { start: [1, -0.9, 0], end: loop.speed(0) });
    // The spiral: two turns of radius 14 down to the funnel, banked into its turn once it has begun.
    const spiral = helix([70, -12, 18], 14, -7, 2, { from: [-1, 0, 0] });
    // From the loop's end on to the spiral's top, sloping gently.
    const out = loop.point(loop.end);
    const onward = curve([out, [28, -4, 5], [spiral.point(0)[0], spiral.point(0)[1], spiral.point(0)[2]]], { start: loop.speed(loop.end), end: spiral.speed(0) });
    const pieces: Piece[] = [
        sweep(ramp, section, { level: true }),
        sweep(loop, section, { twist: loop.facing }),
        sweep(onward, section, { level: true }),
        sweep(spiral, section, { level: true, bank: [0, -0.32, -0.32, -0.32, -0.32, -0.1] }),
    ];
    // The funnel, under where the spiral lets the marbles go.
    const end = spiral.point(spiral.end);
    const funnelAt: V3 = [end[0] + 2, end[1] - 30, end[2] + 22];
    const funnel = turned(funnelAt, [[2.3, 0], [8, 3.5], [16, 9], [26, 18]], 0.3);
    for (const piece of pieces) space.track(piece, { friction: 0.5, bounce: 0.4, roll: 0.003 });
    // rougher, so that marbles circle it a while and then come down, rather than circling for a minute
    space.track(funnel, { friction: 0.5, bounce: 0.4, roll: 0.012 });
    pieces.push(funnel);

    // The tray under the funnel's hole: a floor and four low walls.
    const trayAt: V3 = [funnelAt[0], funnelAt[1] - 7, funnelAt[2]];
    const [span, high] = [17, 3];
    const boxes: Box[] = [
        { at: [trayAt[0], trayAt[1] - 0.5, trayAt[2]], half: [span + 1, 0.5, span + 1] },
        { at: [trayAt[0] - span - 0.5, trayAt[1] + high / 2, trayAt[2]], half: [0.5, high / 2, span + 1] },
        { at: [trayAt[0] + span + 0.5, trayAt[1] + high / 2, trayAt[2]], half: [0.5, high / 2, span + 1] },
        { at: [trayAt[0], trayAt[1] + high / 2, trayAt[2] - span - 0.5], half: [span + 1, high / 2, 0.5] },
        { at: [trayAt[0], trayAt[1] + high / 2, trayAt[2] + span + 0.5], half: [span + 1, high / 2, 0.5] },
    ];
    for (const box of boxes) space.slab(box.at, box.half, undefined, { friction: 0.5, bounce: 0.3 });

    const marbles: Solid[] = [];
    const first = pieces[0]!.ends![0];
    const top: V3 = [first.p[0] - first.up[0] * sink + first.along[0] * 1.5, first.p[1] - first.up[1] * sink + first.along[1] * 1.5, first.p[2] - first.up[2] * sink + first.along[2] * 1.5];
    const inTray = (marble: Solid) => Math.abs(marble.p[0] - trayAt[0]) < span && Math.abs(marble.p[2] - trayAt[2]) < span && marble.p[1] < trayAt[1] + high;
    return {
        space,
        pieces,
        boxes,
        marbles,
        inTray,
        release(gone) {
            if (marbles.length >= MOST) {
                const oldest = marbles.find(inTray) ?? marbles[0]!;
                marbles.splice(marbles.indexOf(oldest), 1);
                space.remove(oldest);
                gone?.(oldest);
            }
            const marble = space.ball(RADIUS, [...top], MARBLE);
            marbles.push(marble);
            return marble;
        },
    };
}
