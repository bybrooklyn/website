// Fixed track, held to geometry and to the arithmetic of a rolling ball: the nearest point of a piece
// is the nearest point of its surface; it changes smoothly, with no seam between chunks or between
// pieces that join; a ball rocking across a gutter keeps the period theory gives, a ball through a
// loop stays on from the release height theory gives, a ball on two rails rolls slower as theory
// says, and a ball in a funnel keeps what it should. In centimetres under real gravity, as a marble
// run is. Run with `bun run test`.

import { expect, test } from "bun:test";
import { MARBLE, join, marbleSpace, type Solid, type Space } from "./space";
import { cosine, curve, gutter, helix, line, rails, sine, sweep, tube, turned, vee, type Piece, type Section, type Touch } from "./track";
import type { V3 } from "./solids";

const G = 981;
const R = 0.8;
const size = (a: V3) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
const minus = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const run = (space: Space, seconds: number, each?: () => void) => {
    for (let step = 0; step < Math.round(seconds * space.rate); step++) {
        space.step(1 / space.rate);
        each?.();
    }
};
/** Every place a ball at `c` touches a piece, from every chunk. */
const touches = (piece: Piece, c: V3, reach = 50): Touch[] => {
    const out: Touch[] = [];
    for (let k = 0; k < piece.chunks; k++) piece.touch(k, c, R, reach, out);
    return out;
};
/** Puts a ball on a piece's surface, from near it, along the way the surface faces. */
const seat = (piece: Piece, ball: Solid, part = 0, where = 0) => {
    for (let go = 0; go < 6; go++) {
        const t = piece.again(part, where, ball.p, R);
        ball.p = [ball.p[0] - t.n[0] * t.gap, ball.p[1] - t.n[1] * t.gap, ball.p[2] - t.n[2] * t.gap];
    }
};
/** A marble with no rolling or spinning cost, for what theory says of a ball that loses nothing. */
const SMOOTH = { ...MARBLE, roll: 0, twist: 0 };
const energy = (ball: Solid) => 0.5 * dot(ball.v, ball.v) + 0.2 * R * R * dot(ball.w, ball.w) + G * ball.p[1];

test("sine and cosine made of + - * / agree with Math.sin and Math.cos to the last bit or two", () => {
    let worst = 0;
    for (let x = -60; x <= 60; x += 0.0137) worst = Math.max(worst, Math.abs(sine(x) - Math.sin(x)), Math.abs(cosine(x) - Math.cos(x)));
    expect(worst).toBeLessThan(1e-15);
});

test("a curve passes through its points, leaves and arrives the ways asked, and bends smoothly through each point", () => {
    const points: V3[] = [[0, 0, 0], [10, 4, 1], [18, 1, 9], [30, -3, 12]];
    const path = curve(points, { start: [1, 0, 0], end: [0, 0, 1] });
    // through each point, at the distances between them
    let along = 0;
    points.forEach((point, i) => {
        if (i) along += size(minus(point, points[i - 1]!));
        expect(size(minus(path.point(along), point))).toBeLessThan(1e-9);
        if (i > 0 && i < points.length - 1) {
            // the bend just before a point is the bend just after it
            expect(size(minus(path.bend(along - 1e-9), path.bend(along + 1e-9)))).toBeLessThan(1e-6);
        }
    });
    const ends = [path.speed(0), path.speed(path.end)].map((d) => d.map((x) => x / size(d)));
    expect(size(minus(ends[0] as V3, [1, 0, 0]))).toBeLessThan(1e-9);
    expect(size(minus(ends[1] as V3, [0, 0, 1]))).toBeLessThan(1e-9);
});

test("the nearest point of a swept tube is the nearest point of its surface, and is square to it", () => {
    const path = curve([[0, 0, 0], [12, 5, 2], [20, 2, 12], [28, -4, 14]]);
    const radius = 2;
    const piece = sweep(path, tube(radius, 0));
    // the surface finely, by its own frames
    const surface: V3[] = [];
    for (let i = 0; i <= 1500; i++) {
        const f = piece.frame((path.end * i) / 1500);
        for (let j = 0; j < 360; j++) {
            const [c, s] = [Math.cos((j * Math.PI) / 180), Math.sin((j * Math.PI) / 180)];
            surface.push([0, 1, 2].map((k) => f.p[k]! + (f.across[k]! * c + f.up[k]! * s) * radius) as V3);
        }
    }
    let seed = 3;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let n = 0; n < 12; n++) {
        const f = piece.frame(path.end * (0.1 + 0.8 * next()));
        const angle = next() * 2 * Math.PI;
        const out = 0.3 + next() * 1.4;
        const c = [0, 1, 2].map((k) => f.p[k]! + (f.across[k]! * Math.cos(angle) + f.up[k]! * Math.sin(angle)) * out) as V3;
        const found = touches(piece, c);
        expect(found.length).toBe(1);
        const best = Math.min(...surface.map((p) => size(minus(p, c))));
        const distance = found[0]!.gap + R;
        expect(Math.abs(distance - best)).toBeLessThan(0.002);
        expect(distance).toBeLessThanOrEqual(best + 1e-9);
        // square to the surface: no part of the way from it to the ball runs along the path
        const g = piece.frame(found[0]!.where);
        expect(Math.abs(dot(found[0]!.n, g.along))).toBeLessThan(1e-9);
    }
});

test("how far a ball is from a piece changes smoothly along it, with no seam where one chunk gives way to the next", () => {
    const piece = sweep(curve([[0, 0, 0], [15, -3, 2], [30, -4, 10], [40, -9, 20]]), gutter(1.5, Math.PI, 0.2), { step: 0.7 });
    const gaps: number[] = [];
    for (let i = 0; i <= 3000; i++) {
        const f = piece.frame((piece.path.end * (0.05 + (0.9 * i) / 3000)));
        const found = touches(piece, [0, 1, 2].map((k) => f.p[k]! - f.up[k]! * 0.55 + f.across[k]! * 0.2) as V3);
        expect(found.length).toBe(1);
        gaps.push(found[0]!.gap);
    }
    // the second difference of a smooth curve sampled finely is tiny; a seam would show as a spike
    let worst = 0;
    for (let i = 1; i + 1 < gaps.length; i++) worst = Math.max(worst, Math.abs(gaps[i + 1]! - 2 * gaps[i]! + gaps[i - 1]!));
    expect(worst).toBeLessThan(1e-7);
});

test("the up carried along a flat curve stays square to its plane; kept level it stays upright; round a helix it faces the axis", () => {
    const flat = sweep(curve([[0, 0, 0], [10, 6, 0], [20, 0, 0], [30, 9, 0]]), tube(1, 0.1), { up: [0, 0, 1] });
    const spiral = helix([0, 0, 0], 12, -6, 2);
    const level = sweep(spiral, gutter(1.5, Math.PI, 0.2), { level: true });
    const loop = helix([0, 10, 0], 10, 4, 1, { axis: [0, 0, 1], from: [0, -1, 0] });
    const facing = sweep(loop, gutter(1.5, Math.PI, 0.2), { twist: loop.facing });
    for (let i = 0; i <= 200; i++) {
        const s = i / 200;
        expect(size(minus(flat.frame(flat.path.end * s).up, [0, 0, 1]))).toBeLessThan(1e-9);
        // level: the up has nothing across, so the gutter is not tipped
        const f = level.frame(spiral.end * s);
        expect(Math.abs(f.across[1])).toBeLessThan(1e-9);
        // round the loop the up points at the axis (the line x = 0, y = 10 along z)
        const g = facing.frame(loop.end * s);
        const toward = [-g.p[0], 10 - g.p[1], 0] as V3;
        expect(dot(g.up, toward) / size(toward)).toBeGreaterThan(1 - 1e-6);
    }
});

test("a ball rocking across a gutter keeps the period of a rolling ball, 2 pi root(7 rho / 5 g)", () => {
    const space = marbleSpace();
    space.sleeps = false;
    const [radius, thick] = [5, 0.2];
    space.track(sweep(line([-50, 0, 0], [50, 0, 0]), gutter(radius, Math.PI, thick)));
    const rho = radius - thick / 2 - R;
    const amplitude = 0.15;
    const ball = space.ball(R, [0, -rho * Math.cos(amplitude), rho * Math.sin(amplitude)], SMOOTH);
    ball.p = [0, -rho * Math.cos(amplitude), rho * Math.sin(amplitude)];
    const crossings: number[] = [];
    let [last, time] = [ball.p[2], 0];
    run(space, 3, () => {
        time += 1 / space.rate;
        if (last > 0 && ball.p[2] <= 0) crossings.push(time - ball.p[2] / (ball.p[2] - last) / space.rate);
        last = ball.p[2];
    });
    const period = (crossings[crossings.length - 1]! - crossings[0]!) / (crossings.length - 1);
    // with the small correction for a swing that is not infinitely small
    const theory = 2 * Math.PI * Math.sqrt((7 * rho) / (5 * G)) * (1 + (amplitude * amplitude) / 16);
    expect(crossings.length).toBeGreaterThan(4);
    expect(Math.abs(period / theory - 1)).toBeLessThan(0.01);
});

/** A ball let go on a ramp into a loop of radius 10, its middle `height` loop radii above where it is at the loop's bottom: how far it comes off the track at most on the way round. */
function loop(height: number): number {
    const space = marbleSpace();
    space.sleeps = false;
    const [radius, wide, thick] = [10, 1.5, 0.2];
    const sink = wide - thick / 2 - R;
    // the ball's middle runs round a circle this big
    const rho = radius + sink;
    const round = helix([0, radius, 0], radius, 4, 1, { axis: [0, 0, 1], from: [0, -1, 0] });
    const bottom = round.point(0);
    const ramp = curve([[-70, rho * height, -0.8], [-35, rho * height * 0.25, -0.4], bottom], { start: [1, -0.8, 0], end: round.speed(0) });
    // kept level, so that it ends facing up the way the loop starts, and the two are joined
    const first = sweep(ramp, gutter(wide, Math.PI * 0.9, thick), { level: true });
    const second = sweep(round, gutter(wide, Math.PI * 0.9, thick), { twist: round.facing });
    space.track(first);
    space.track(second);
    const f = first.frame(0);
    const ball = space.ball(R, [0, 1, 2].map((k) => f.p[k]! - f.up[k]! * sink) as V3, SMOOTH);
    let [turned, last, most, started] = [0, 0, 0, false];
    for (let step = 0; step < 3 * space.rate && turned < 2 * Math.PI - 0.3 && ball.p[1] > -30; step++) {
        space.step(1 / space.rate);
        const [x, y] = [ball.p[0], ball.p[1] - radius];
        started ||= x > 0 && y < 0;
        if (!started) continue;
        let d = Math.atan2(x, -y) - last;
        d += d > Math.PI ? -2 * Math.PI : d < -Math.PI ? 2 * Math.PI : 0;
        turned += d;
        last += d;
        if (turned > 0.3) most = Math.max(most, second.again(0, (turned / (2 * Math.PI)) * round.end, ball.p, R).gap);
    }
    return most;
}

test("a rolling ball goes round a loop held on only when let go from 2.7 loop radii up or higher", () => {
    // Theory: at the top it needs v^2 >= g rho, and rolling takes 2/7 of what it gains for spin, so it
    // must start 2 + 0.7 = 2.7 radii above the bottom (rho, the circle its middle goes round).
    expect(loop(2.6)).toBeGreaterThan(0.3);
    expect(loop(2.65)).toBeGreaterThan(0.1);
    expect(loop(2.75)).toBeLessThan(0.01);
    expect(loop(2.8)).toBeLessThan(0.01);
});

test("a ball rolling down two round rails goes slower than on the flat, as rolling on a smaller circle says", () => {
    const degrees = 8;
    const angle = (degrees * Math.PI) / 180;
    const [apart, rail] = [1.2, 0.15];
    const space = marbleSpace();
    space.sleeps = false;
    const piece = sweep(line([0, 0, 0], [200 * Math.cos(angle), -200 * Math.sin(angle), 0]), rails(apart, rail));
    space.track(piece);
    // its middle sits above the line between the rails, at the height where it touches both
    const up = Math.sqrt((R + rail) ** 2 - (apart / 2) ** 2);
    const f = piece.frame(5);
    const ball = space.ball(R, [0, 1, 2].map((k) => f.p[k]! + f.up[k]! * up) as V3, SMOOTH);
    const from: V3 = [...ball.p];
    run(space, 0.8);
    const rate = (2 * size(minus(ball.p, from))) / (0.8 * 0.8) / (G * Math.sin(angle));
    // the ball turns about its middle; the points it rolls on are only this far below the axis it turns on
    const reach = (R * up) / (R + rail);
    expect(Math.abs(rate / (1 / (1 + 0.4 * (R / reach) ** 2)) - 1)).toBeLessThan(0.01);
    // and slower than on the flat
    expect(rate).toBeLessThan(5 / 7 - 0.05);
});

/** A cone for a funnel: a hole 2.5 across at the bottom up to a rim 30 out and 18 high. */
const cone = () => turned([0, 0, 0], [[2.5, 0], [10, 5], [20, 11], [30, 18]], 0.3);

/** A ball set on the cone 21 out and sent round it at less than the speed of a circling orbit, rolling from the start if `friction`. */
function funnel(friction: number, roll = 0): { space: Space; ball: Solid; piece: Piece } {
    const space = marbleSpace();
    space.sleeps = false;
    const piece = cone();
    space.track(piece);
    const ball = space.ball(R, [21, 14, 0], { ...SMOOTH, friction, roll });
    seat(piece, ball, 0, 20);
    ball.v = [0, 0, 70];
    if (friction) {
        // already rolling: turning so that the point it touches is still
        const n = piece.again(0, 20, ball.p, R).n;
        ball.w = [(n[1] * ball.v[2] - n[2] * ball.v[1]) / R, (n[2] * ball.v[0] - n[0] * ball.v[2]) / R, (n[0] * ball.v[1] - n[1] * ball.v[0]) / R];
    }
    return { space, ball, piece };
}

test("a smooth ball circling in a funnel keeps its turning about the funnel's axis and its energy", () => {
    const { space, ball } = funnel(0);
    const turning = () => ball.p[2] * ball.v[0] - ball.p[0] * ball.v[2];
    const [first, start] = [turning(), energy(ball)];
    let [worstTurning, worstEnergy, low, high] = [0, 0, Infinity, 0];
    run(space, 3, () => {
        worstTurning = Math.max(worstTurning, Math.abs(turning() / first - 1));
        worstEnergy = Math.max(worstEnergy, Math.abs(energy(ball) - start) / (G * 18));
        const out = Math.hypot(ball.p[0], ball.p[2]);
        [low, high] = [Math.min(low, out), Math.max(high, out)];
    });
    // the push of a surface turned about an axis has no lever about that axis
    expect(worstTurning).toBeLessThan(1e-4);
    expect(worstEnergy).toBeLessThan(0.002);
    // it swings in and out as it goes round, but stays in the funnel
    expect(low).toBeGreaterThan(5);
    expect(high).toBeLessThan(25);
});

test("a ball rolling round a funnel keeps its energy, and with a rolling cost circles down and drops through the hole", () => {
    const rolling = funnel(MARBLE.friction!);
    const start = energy(rolling.ball);
    let worst = 0;
    run(rolling.space, 3, () => (worst = Math.max(worst, Math.abs(energy(rolling.ball) - start) / (G * 18))));
    expect(worst).toBeLessThan(0.002);

    const costly = funnel(MARBLE.friction!, 0.01);
    let [turns, last, top] = [0, 0, costly.ball.p[1]];
    let time = 0;
    for (; time < 40 && costly.ball.p[1] > -3; time += 1 / costly.space.rate) {
        costly.space.step(1 / costly.space.rate);
        const angle = Math.atan2(costly.ball.p[2], costly.ball.p[0]);
        let d = angle - last;
        d += d > Math.PI ? -2 * Math.PI : d < -Math.PI ? 2 * Math.PI : 0;
        [turns, last] = [turns + d / (2 * Math.PI), angle];
        top = Math.max(top, costly.ball.p[1]);
    }
    // it went round many times on the way down, never climbing above where it started, and out through the hole
    expect(Math.abs(turns)).toBeGreaterThan(8);
    expect(costly.ball.p[1]).toBeLessThan(-3);
    expect(Math.hypot(costly.ball.p[0], costly.ball.p[2])).toBeLessThan(2.5);
});

test("a ball let go at the top of a banked spiral runs down it in the gutter and arrives with the speed its drop gives", () => {
    const space = marbleSpace();
    space.sleeps = false;
    const spiral = helix([0, 0, 0], 15, -5, 1.5);
    // banked into the turn, as a real one is: unbanked and faster, a ball climbs the outer wall until friction cannot hold its roll
    const piece = sweep(spiral, gutter(1.6, Math.PI * 1.1, 0.2), { level: true, bank: 0.35 });
    space.track(piece);
    const f = piece.frame(1);
    const ball = space.ball(R, [0, 1, 2].map((k) => f.p[k]! - f.up[k]! * 0.6) as V3, SMOOTH);
    seat(piece, ball, 0, 1);
    const start = energy(ball);
    let [most, where] = [0, 1];
    while (where < spiral.end - 2) {
        space.step(1 / space.rate);
        const t = piece.again(0, where, ball.p, R);
        [most, where] = [Math.max(most, t.gap), t.where];
    }
    // it never left the gutter, and what it lost in height it has as speed and spin, but for a little
    // lost where it rocks up the wall and slips
    expect(most).toBeLessThan(0.01);
    expect(Math.abs(energy(ball) - start) / (start - G * ball.p[1])).toBeLessThan(0.03);
});

test("a gutter cut into pieces end to end is one surface to a ball: the same run to a hair as one piece", () => {
    const ride = (pieces: number) => {
        const space = marbleSpace();
        space.sleeps = false;
        for (let k = 0; k < pieces; k++) space.track(sweep(line([-40 + (80 * k) / pieces, -k * 0.5 * (8 / pieces), 0], [-40 + (80 * (k + 1)) / pieces, -(k + 1) * 0.5 * (8 / pieces), 0]), gutter(1.5, Math.PI, 0.2)));
        const ball = space.ball(R, [-38, -2 * (4 / 80) - 0.6, 0], SMOOTH);
        ball.v = [150, -150 * (4 / 80), 0];
        let bump = 0;
        run(space, 0.45, () => (bump = Math.max(bump, Math.abs(ball.v[1] / ball.v[0] + 4 / 80))));
        return { p: ball.p, bump };
    };
    const [one, eight] = [ride(1), ride(8)];
    expect(size(minus(one.p, eight.p))).toBeLessThan(1e-6);
    // never leaving the slope's line, not even for a moment at a join
    expect(eight.bump).toBeLessThan(1e-6);
});

test("pieces that meet end to end with the same section are joined; others are not", () => {
    const a = sweep(curve([[0, 0, 0], [10, 0, 0]]), gutter(1.5, Math.PI, 0.2));
    const b = sweep(curve([[10, 0, 0], [20, 0, 5]], { start: [1, 0, 0] }), gutter(1.5, Math.PI, 0.2));
    const c = sweep(curve([[20, 0, 5], [30, 0, 5]]), vee(3, 2, 0.2));
    join([a, b, c]);
    expect(a.joined).toEqual([false, true]);
    expect(b.joined).toEqual([true, false]);
    expect(c.joined).toEqual([false, false]);
});

test("the fastest marble a long steep drop gives does not pass through the thinnest rail, from any side, nor at three times that speed", () => {
    // How fast a marble gets: let go at the top of a metre's drop down a gutter, steep as it can be.
    const space = marbleSpace();
    space.sleeps = false;
    const drop = sweep(curve([[0, 100, 0], [57, 1, 0], [80, 0, 0], [200, 0, 0]], { start: [1, -1.7, 0], end: [1, 0, 0] }), gutter(1.5, Math.PI, 0.2), { level: true });
    space.track(drop);
    const marble = space.ball(R, [0.5, 100 - 0.6, 0], MARBLE);
    let fastest = 0;
    run(space, 0.7, () => (fastest = Math.max(fastest, size(marble.v))));
    // falling free the whole metre it would reach 443 cm/s; down track it is slower, by its rolling and its rubbing
    expect(fastest).toBeGreaterThan(300);
    expect(fastest).toBeLessThan(Math.sqrt(2 * G * 100));
    console.log(`fastest marble after a metre's drop: ${fastest.toFixed(0)} cm/s, ${(fastest / space.rate).toFixed(2)} cm a step`);

    // Marbles spinning any way, fired at a single round rod from every side, squarely and glancing.
    const rod = (radius: number): Section => [{ from: [0, 0], to: [0, 0], thick: 2 * radius }];
    let seed = 5;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (const radius of [0.05, 0.2]) {
        for (const speed of [450, 750, 1500]) {
            for (let shot = 0; shot < 30; shot++) {
                const space = marbleSpace();
                space.gravity = [0, 0, 0];
                space.sleeps = false;
                space.track(sweep(line([-30, 0, 0], [30, 0, 0]), rod(radius)));
                const angle = next() * 2 * Math.PI;
                const aside = (next() - 0.5) * 2 * (R + radius) * 0.95;
                const toward: V3 = [0, Math.cos(angle), Math.sin(angle)];
                const across: V3 = [0, -Math.sin(angle), Math.cos(angle)];
                const along = (next() - 0.5) * 0.4;
                const ball = space.ball(R, [along * 10, -toward[1] * 20 + across[1] * aside, -toward[2] * 20 + across[2] * aside], { ...MARBLE, bounce: 0.3 });
                ball.v = [along * speed, toward[1] * speed, toward[2] * speed];
                ball.w = [(next() - 0.5) * 400, (next() - 0.5) * 400, (next() - 0.5) * 400];
                let deepest = 0;
                run(space, 0.1, () => (deepest = Math.max(deepest, R + radius - Math.hypot(ball.p[1], ball.p[2]))));
                // never into the rod by more than a hair, and not out the far side in its shadow
                expect(deepest).toBeLessThan(0.02);
                const past = dot(ball.p, toward) > 0 && Math.abs(dot(ball.p, across)) < R + radius - 0.05;
                expect(past).toBe(false);
            }
        }
    }
});
