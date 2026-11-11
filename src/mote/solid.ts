// Solids that fall and tumble: just enough 3D physics for dice.
//
// A die is its corners, with a place, a turn, a speed and a spin. Each step
// every corner is checked against every flat surface; a corner that has gone
// through one is pushed back and the die is given the bounce and the rub that
// a real corner would get, which is what makes it tumble. Dice knock into
// each other as balls. Its mass is spread as a ball's is, whatever its shape.
// Units are arbitrary; y points up.

import { apply, cross, dot3, minus, normals, plus, scaled, spun, unit, upright, type Mesh, type Turn, type V3 } from "./three";

export interface Tumbler {
    mesh: Mesh;
    at: V3;
    turn: Turn;
    speed: V3;
    spin: V3;
    /** No corner is further than this from its middle. */
    reach: number;
    /** How long it has been nearly still, in seconds. */
    quiet: number;
}

/** A flat surface: everything with `toward . p < level` is behind it. `where` limits it to part of space. */
export interface Surface {
    toward: V3;
    level: number;
    where?(point: V3): boolean;
}

export const surface = (toward: V3, through: V3, where?: (point: V3) => boolean): Surface => {
    const out = unit(toward);
    return { toward: out, level: dot3(out, through), where };
};

export const tumbler = (mesh: Mesh, at: V3, speed: V3 = [0, 0, 0], spin: V3 = [0, 0, 0]): Tumbler => ({
    mesh, at, speed, spin, turn: upright(), quiet: 0,
    reach: Math.max(...mesh.points.map((point) => Math.hypot(...point))),
});

export const GRAVITY = 32;
const BOUNCE = 0.32;
const RUB = 0.4;

/** Moves every tumbler on by `dt` seconds among these surfaces. */
export function tumble(all: Tumbler[], surfaces: Surface[], dt: number): void {
    for (const die of all) {
        die.speed[1] -= GRAVITY * dt;
        // A ball's mass: 1, spread 0.4 r^2.
        const spread = 0.4 * die.reach * die.reach;
        let touching = false;
        for (const corner of die.mesh.points) {
            const arm = apply(die.turn, corner);
            const point = plus(die.at, arm);
            for (const { toward, level, where } of surfaces) {
                const depth = dot3(toward, point) - level;
                // A surface is hit from its front: by a die whose middle is still in front of it.
                // A corner that comes up underneath, or past its edge, has not hit anything.
                if (depth >= 0 || dot3(toward, die.at) < level || (where && !where(point))) continue;
                touching = true;
                die.at = plus(die.at, scaled(toward, -depth * 0.5));
                const moving = plus(die.speed, cross(die.spin, arm));
                const into = dot3(moving, toward);
                if (into >= 0) continue;
                const lever = cross(arm, toward);
                const push = (-(1 + (into < -2 ? BOUNCE : 0)) * into) / (1 + dot3(lever, lever) / spread);
                // The rub: against the way the corner is sliding, and no stronger than the push allows.
                const slide = minus(moving, scaled(toward, into));
                const sliding = Math.hypot(...slide);
                const drag = sliding > 1e-6 ? scaled(slide, -Math.min(RUB * push, sliding / (1 + 1 / 0.4)) / sliding) : ([0, 0, 0] as V3);
                const kick = plus(scaled(toward, push), drag);
                die.speed = plus(die.speed, kick);
                die.spin = plus(die.spin, scaled(cross(arm, kick), 1 / spread));
            }
        }
        if (touching) die.spin = scaled(die.spin, 1 - 1.2 * dt);
    }
    // each other, as balls
    for (let first = 0; first < all.length; first++) {
        for (let second = first + 1; second < all.length; second++) {
            const [a, b] = [all[first]!, all[second]!];
            const between = minus(b.at, a.at);
            const apart = Math.hypot(...between);
            const least = (a.reach + b.reach) * 0.8;
            if (apart >= least || apart < 1e-6) continue;
            const along = scaled(between, 1 / apart);
            a.at = plus(a.at, scaled(along, (apart - least) / 2));
            b.at = plus(b.at, scaled(along, (least - apart) / 2));
            const closing = dot3(minus(b.speed, a.speed), along);
            if (closing < 0) {
                a.speed = plus(a.speed, scaled(along, closing * 0.7));
                b.speed = plus(b.speed, scaled(along, -closing * 0.7));
            }
        }
    }
    for (const die of all) {
        die.at = plus(die.at, scaled(die.speed, dt));
        die.turn = spun(die.turn, scaled(die.spin, dt));
        const still = Math.hypot(...die.speed) < 0.35 && Math.hypot(...die.spin) < 0.6;
        die.quiet = still ? die.quiet + dt : 0;
        if (die.quiet > 0.4) [die.speed, die.spin] = [[0, 0, 0], [0, 0, 0]];
    }
}

export const settled = (die: Tumbler) => die.quiet > 0.4;

/** Which face is on top (or, with `down`, underneath). */
export function facing(die: Tumbler, down = false): number {
    const ups = normals(die.mesh).map((normal) => apply(die.turn, normal)[1] * (down ? -1 : 1));
    return ups.indexOf(Math.max(...ups));
}
