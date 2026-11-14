// The pillars that hold a marble run up, made by themselves from where its pieces are: one under each
// joint that is off the ground, where the blocks of two pieces that meet both rest on it, and one under
// each place a piece says it is held (the spiral's post, the funnel's legs, under the tray and the
// hopper's box). Each stands on the ground. A pillar that would pass through another piece, or through
// the room a marble rolls in above one, is not made: nothing is ever put in a marble's way.
//
//   pillars(run);        // [{ x, z, top }, ...] in centimetres

import { DEEP, boxToWorld, shapeOf, toWorld, type Box } from "./pieces";
import { jointsOf, type Placed } from "./run";

/** A pillar's side, in centimetres. */
export const PILLAR = 2;

/** A pillar from the ground up to `top`, square about (x, z). */
export interface Pillar {
    x: number;
    z: number;
    top: number;
}

/** Whether two boxes cross by more than a hair. */
const crosses = (a: Box, b: Box) => [0, 1, 2].every((axis) => Math.abs(a.at[axis]! - b.at[axis]!) < a.half[axis]! + b.half[axis]! - 1e-6);

/** The pillars a run needs, each once, in the order of the pieces they hold. */
export function pillars(run: Placed[]): Pillar[] {
    const rooms = new Map(run.map((piece) => [piece.id, shapeOf(piece.kind).room.map((box) => boxToWorld(piece.place, box))]));
    /** Every place a pillar is wanted, with the pieces it holds, which it may touch. */
    const wanted = new Map<string, { pillar: Pillar; holds: Set<number> }>();
    const want = (x: number, z: number, top: number, id: number) => {
        if (top <= 1e-9) return;
        const key = `${Math.round(x * 1000)} ${Math.round(z * 1000)} ${Math.round(top * 1000)}`;
        const was = wanted.get(key);
        if (was) was.holds.add(id);
        else wanted.set(key, { pillar: { x, z, top }, holds: new Set([id]) });
    };
    for (const piece of run) {
        for (const joint of jointsOf(piece)) want(joint.at[0], joint.at[2], joint.at[1] - DEEP, piece.id);
        for (const hold of shapeOf(piece.kind).holds) {
            const at = toWorld(piece.place, hold);
            want(at[0], at[2], at[1], piece.id);
        }
    }
    const made: Pillar[] = [];
    for (const { pillar, holds } of wanted.values()) {
        const column: Box = { at: [pillar.x, pillar.top / 2, pillar.z], half: [PILLAR / 2, pillar.top / 2, PILLAR / 2] };
        const blocked = run.some((piece) => !holds.has(piece.id) && rooms.get(piece.id)!.some((box) => crosses(box, column)));
        if (!blocked) made.push(pillar);
    }
    return made;
}
