// The Plinko table, without its picture: a sloped table of posts, balls that roll down it, and how a
// password comes out of them. plinko.ts draws it. It is kept apart so that the tests can roll
// thousands of balls with no screen.
//
// Every ball is a character, drawn fairly from the browser's secure source of chance when the ball
// is made. The table decides nothing but the order: the password is the balls' characters in the
// order they roll over the line at the foot of the posts. A character chosen fairly stays fair
// whatever order it arrives in, so the table can be as uneven as it likes.

import type { V3 } from "../mote/solids";
import { Space, type Solid } from "../mote/space";

export interface Settings {
    /** How many characters, and so how many balls. */
    length: number;
    lower: boolean;
    upper: boolean;
    digits: boolean;
    symbols: boolean;
    /** Rows of posts, how much of its speed a ball keeps when it hits one, and how hard the pull down the table is against the usual 1. */
    rows: number;
    bounce: number;
    gravity: number;
}

export const DEFAULTS: Settings = { length: 16, lower: true, upper: true, digits: true, symbols: true, rows: 8, bounce: 0.5, gravity: 1 };
export const LIMITS = { length: [4, 64], rows: [4, 11], bounce: [0.2, 0.8], gravity: [0.7, 1.6] } as const;

const KINDS = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    symbols: "!@#$%^&*()-_=+[]{};:,.?/",
};

/** Every character a password may be made of. With no kind chosen it is the small letters. */
export function alphabet(settings: Pick<Settings, keyof typeof KINDS>): string {
    return (Object.keys(KINDS) as (keyof typeof KINDS)[]).filter((kind) => settings[kind]).map((kind) => KINDS[kind]).join("") || KINDS.lower;
}

/** How hard a password is to guess, in bits: each character is one of so many, chosen fairly. */
export const strength = (settings: Settings): number => settings.length * Math.log2(alphabet(settings).length);

/**
 * A whole number from 0 to one under `below`, each as likely as the others, from the browser's secure
 * source. A number that falls in the uneven last stretch of what the source can give is thrown away
 * and another taken, which is what keeps the small numbers from coming up a shade more often.
 */
export function fair(below: number, source: (into: Uint32Array) => unknown = (into) => crypto.getRandomValues(into)): number {
    const even = Math.floor(2 ** 32 / below) * below;
    const one = new Uint32Array(1);
    do source(one);
    while (one[0]! >= even);
    return one[0]! % below;
}

// The table, in its own units: x across it, z down it from the top, y up out of it.
// (two balls side by side are wider than the way between two posts by very little, so they seldom wedge there as an arch)
export const BALL = 0.36;
export const POST = 0.18;
/** How tall a post stands, and how far apart posts are across the table and down it. */
export const TALL = 1.1;
export const ACROSS = 1.7;
export const DOWN = 1.5;
/** How many posts' worth wide the table is. A row has one or two fewer, so that a ball always fits between the last post and the side. */
const COLUMNS = 7;
export const WIDE = COLUMNS * ACROSS;
/** From the top of the table to the first row. */
const HEAD = 2.2;
/** The bin the balls roll off the foot of the table into: how long it is, and how far its floor is below the table. */
export const BIN = 3.4;
export const DEEP = 2.4;
/** How steep the table is, in radians. */
export const TILT = (22 * Math.PI) / 180;
/** A ball that has not crossed the line this long after it was let go is counted where it is. */
const PATIENCE = 40;

/** How long after one ball the next is let go, in seconds: unhurried for a short password, quicker for a long one. */
export const pace = (length: number): number => Math.max(0.22, Math.min(0.5, 9 / length));

export interface Ball {
    body: Solid;
    character: string;
    /** Not yet let onto the table. */
    waiting: boolean;
    /** Its place in the password, once it has crossed the line. */
    place?: number;
}

export interface Board {
    readonly space: Space;
    readonly balls: Ball[];
    /** Where each post stands, and the post itself. */
    readonly posts: { x: number; z: number; body: Solid }[];
    /** How long the table and its bin are together, and how far down the foot of the table is, which a ball rolls off to be counted. */
    readonly long: number;
    readonly line: number;
    /** The balls that have crossed the line, in order. */
    readonly order: Ball[];
    /** Seconds since the first ball. */
    time: number;
    /** How many balls ran out of time. */
    late: number;
    /** Told when a ball crosses the line. */
    landed?: (ball: Ball) => void;
    step(dt: number): void;
    /** Every ball has crossed the line. */
    done(): boolean;
    password(): string;
}

/**
 * Sets a table up and lets `settings.length` balls go from the top, one every `every` seconds. `pick`
 * gives the fair numbers characters are chosen with; `chance` only scatters where the balls start, and
 * need not be fair.
 */
export function drop(settings: Settings, pick: (below: number) => number = fair, chance: () => number = Math.random, every = pace(settings.length)): Board {
    const letters = alphabet(settings);
    const line = HEAD + settings.rows * DOWN - DOWN / 2;
    const long = line + BIN;
    const space = new Space();
    space.sleeps = true;
    // A table tipped by TILT is the same as a level one with the pull tipped the other way, which keeps the table square to the numbers.
    const pull = 34 * settings.gravity;
    space.gravity = [0, -pull * Math.cos(TILT), pull * Math.sin(TILT)];
    const felt = { friction: 0.5 };

    // the table, thick enough that nothing in the bin can get under it; the bin's floor; the two sides, the top end and the far end of the bin
    space.slab([0, -2, line / 2 - 0.5], [WIDE / 2 + 1, 2, line / 2 + 0.5], undefined, felt);
    space.slab([0, -DEEP - 0.5, line + BIN / 2], [WIDE / 2 + 1, 0.5, BIN / 2 + 0.5], undefined, felt);
    for (const side of [-1, 1]) space.slab([side * (WIDE / 2 + 0.25), -0.8, long / 2], [0.25, 2.3, long / 2 + 0.5], undefined, felt);
    space.slab([0, 0.6, -0.25], [WIDE / 2 + 0.5, 0.9, 0.25], undefined, felt);
    space.slab([0, -0.8, long + 0.25], [WIDE / 2 + 0.5, 2.3, 0.25], undefined, felt);
    // the posts: each row set half a step across from the one above, and one post shorter
    const posts: Board["posts"] = [];
    for (let row = 0; row < settings.rows; row++) {
        const shifted = row % 2;
        for (let post = 0; post < COLUMNS - 1 - shifted; post++) {
            const [x, z] = [(post - (COLUMNS - 2 - shifted) / 2) * ACROSS, HEAD + row * DOWN];
            posts.push({ x, z, body: space.post([x, 0, z], [x, TALL, z], POST, { friction: 0.2, bounce: settings.bounce }) });
        }
    }

    // each ball is its character from the start, and waits out of the way until its turn
    const starts: V3[] = [];
    const balls = Array.from({ length: settings.length }, (_, index): Ball => {
        starts.push([(chance() - 0.5) * WIDE * 0.7, BALL, 0.5 + BALL]);
        const body = space.ball([index * 3, 400, 0], BALL, { friction: 0.5, bounce: settings.bounce });
        body.v = [(chance() - 0.5) * 2, 0, 1 + chance()];
        body.spinDamping = 1.6;
        space.hold(body);
        return { body, character: letters[pick(letters.length)]!, waiting: true };
    });
    const born: number[] = [];
    const order: Ball[] = [];
    let gone = 0;

    const board: Board = {
        space, balls, posts, long, line, order,
        time: 0,
        late: 0,
        step(dt) {
            // the next ball goes on once its turn has come and there is room where it starts
            const [next, start] = [balls[gone], starts[gone]];
            if (next && start && board.time >= gone * every && balls.every((ball) => ball.waiting || Math.hypot(ball.body.p[0] - start[0], ball.body.p[2] - start[2]) > BALL * 2.2)) {
                next.waiting = false;
                next.body.p = start;
                space.wake(next.body);
                born[gone++] = board.time;
            }
            space.step(dt);
            board.time += dt;
            balls.forEach((ball, index) => {
                if (ball.waiting || ball.place !== undefined) return;
                const late = board.time - born[index]! > PATIENCE;
                // come to rest above the line, balanced against a post or another ball: a push to one side
                if (ball.body.rest && ball.body.p[2] < line) {
                    space.wake(ball.body);
                    ball.body.v = [chance() < 0.5 ? -3 : 3, 0, -2.5];
                }
                if (ball.body.p[2] < line && !late) return;
                if (late) board.late++;
                ball.place = order.length;
                order.push(ball);
                board.landed?.(ball);
            });
        },
        done: () => order.length === settings.length,
        password: () => order.map((ball) => ball.character).join(""),
    };
    return board;
}
