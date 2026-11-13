// The Plinko board, without its picture: pegs, balls, bins, and how a password comes out of them.
// plinko.ts draws it. It is kept apart so that the tests can drop thousands of balls with no screen.
//
// A Plinko board is not fair: a ball ends up near the middle far more often than at the edges. So
// the board alone does not choose a character. Every bin shows a character drawn fairly from the
// browser's secure source of chance, and a bin that catches a ball gives its character up and is
// given a new one. Which bin a ball reaches has nothing to do with what that bin holds, so every
// character is as likely as every other, whatever the board does. The balls go one after another,
// and the password is the characters in the order they landed.

import { record, whole, within } from "./checked";
import { Flat, send, speed, type Body } from "../mote/flat";

export interface Settings {
    /** How many characters, and so how many balls. */
    length: number;
    lower: boolean;
    upper: boolean;
    digits: boolean;
    symbols: boolean;
    /** Rows of pegs, how much of its speed a ball keeps when it hits one, and how heavy the pull down is against the usual 1. */
    rows: number;
    bounce: number;
    gravity: number;
}

export const DEFAULTS: Settings = { length: 16, lower: true, upper: true, digits: true, symbols: true, rows: 8, bounce: 0.55, gravity: 1 };
export const LIMITS = { length: [4, 64], rows: [5, 11], bounce: [0.2, 0.8], gravity: [0.5, 1.6] } as const;

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

// The board is measured in the units of Mote's 2D physics, which are a screen's pixels.
export const PEG = 11;
export const BALL = 14;
/** From one peg to the next along a row, and from one row to the next. */
export const ACROSS = 60;
export const DOWN = 52;
export const BINS = 9;
export const WIDTH = BINS * ACROSS;
/** Above the first row, where the balls come in, and how deep the bins are. */
const HEAD = 70;
export const BIN = 70;
/** The pull down, in the physics' own units: slow enough that a ball can be followed from peg to peg. */
const PULL = 1150;
/** A ball that has not landed this long after it was let go is given its character without the board. */
const PATIENCE = 14;

/** How long after one ball the next is let go, in seconds: unhurried for a short password, quicker for a long one. */
export const pace = (length: number): number => Math.max(0.16, Math.min(0.45, 9 / length));

export interface Landing {
    /** Which bin, the ball that landed in it, and the character the bin showed. */
    bin: number;
    ball: Body;
    character: string;
}

export interface Board {
    readonly flat: Flat;
    readonly height: number;
    /** Where the bins begin, from the top. */
    readonly shelf: number;
    readonly pegs: Body[];
    /** The balls on the board now, and when each landed, if it has (it stays a moment, then goes). */
    readonly balls: Map<Body, number | undefined>;
    /** What each bin shows now. */
    readonly shown: string[];
    readonly landings: Landing[];
    /** Seconds since the first ball. */
    time: number;
    /** Told when a ball lands. */
    landed?: (landing: Landing) => void;
    /** How many balls ran out of time and were given a character without the board. */
    late: number;
    step(dt: number): void;
    /** Every ball has landed. */
    done(): boolean;
    password(): string;
}

/**
 * Sets a board up and lets `settings.length` balls go from the top, one every `every` seconds. `pick`
 * gives the fair numbers characters are chosen with; `chance` only scatters where the balls start, and
 * need not be fair.
 */
export function drop(settings: Settings, pick: (below: number) => number = fair, chance: () => number = Math.random, every = pace(settings.length)): Board {
    const letters = alphabet(settings);
    const shelf = HEAD + settings.rows * DOWN;
    const height = shelf + BIN;
    const flat = new Flat(PULL * settings.gravity);
    const stuff = { bounce: settings.bounce, friction: 0.05 };

    // the sides and the floor, and a short wall between each bin and the next
    flat.wall([[0, -400], [0, height], [WIDTH, height], [WIDTH, -400]]);
    for (let wall = 1; wall < BINS; wall++) flat.bar(wall * ACROSS, shelf + BIN / 2, BIN, 6, { fixed: true, friction: 0.05, angle: Math.PI / 2 });
    // the pegs: each row set half a step across from the one above, so a ball cannot fall straight through
    const pegs: Body[] = [];
    // (and one peg shorter, so that no ball is caught between a peg and the side)
    for (let row = 0; row < settings.rows; row++) {
        const shifted = row % 2;
        for (let peg = 1; peg < BINS - shifted; peg++) pegs.push(flat.ball((peg + shifted / 2) * ACROSS, HEAD + row * DOWN, PEG, { fixed: true, ...stuff }));
    }

    const draw = () => letters[pick(letters.length)]!;
    const shown = Array.from({ length: BINS }, draw);
    const balls = new Map<Body, number | undefined>();
    const born = new Map<Body, number>();
    const landings: Landing[] = [];
    let let_go = 0;

    const board: Board = {
        flat, height, shelf, pegs, balls, shown, landings,
        time: 0,
        late: 0,
        step(dt) {
            // one ball after another, each from its own place near the middle of the top with a little push
            while (let_go < settings.length && board.time >= let_go * every) {
                const ball = flat.ball(WIDTH * (0.3 + chance() * 0.4), -BALL, BALL, stuff);
                send(ball, (chance() - 0.5) * 120, 0);
                balls.set(ball, undefined);
                born.set(ball, board.time);
                let_go++;
            }
            flat.step(dt);
            board.time += dt;
            for (const [ball, since] of balls) {
                if (since !== undefined) {
                    // a ball that has landed lies in its bin for half a second, then makes room
                    if (board.time - since > 0.5) {
                        flat.remove(ball);
                        balls.delete(ball);
                    }
                    continue;
                }
                const late = board.time - born.get(ball)! > PATIENCE;
                if (ball.y > shelf + BALL || late) {
                    const bin = Math.max(0, Math.min(BINS - 1, Math.floor(ball.x / ACROSS)));
                    // the bin's character as it stands; one that never arrived is given a character drawn the same fair way
                    const landing = { bin, ball, character: late ? draw() : shown[bin]! };
                    landings.push(landing);
                    if (late) board.late++;
                    balls.set(ball, board.time);
                    // and the bin is given a new one, for the next ball it catches
                    shown[bin] = draw();
                    board.landed?.(landing);
                } else if (ball.asleep || (speed(ball) < 4 && ball.y > 0)) {
                    // come to rest on a peg or on another ball: a push to one side
                    send(ball, (chance() - 0.5) * 120, -30);
                }
            }
        },
        done: () => landings.length === settings.length,
        password: () => landings.map((landing) => landing.character).join(""),
    };
    return board;
}

/** Settings kept from an earlier visit, read back as sane values inside the limits; anything missing or not of its kind is the default. */
export function keptSettings(value: unknown): Settings {
    const kept = record(value) ?? {};
    const yes = (name: "lower" | "upper" | "digits" | "symbols") => (typeof kept[name] === "boolean" ? (kept[name] as boolean) : DEFAULTS[name]);
    return {
        length: whole(kept.length, LIMITS.length[0], LIMITS.length[1], DEFAULTS.length),
        lower: yes("lower"),
        upper: yes("upper"),
        digits: yes("digits"),
        symbols: yes("symbols"),
        rows: whole(kept.rows, LIMITS.rows[0], LIMITS.rows[1], DEFAULTS.rows),
        bounce: within(kept.bounce, LIMITS.bounce[0], LIMITS.bounce[1], DEFAULTS.bounce),
        gravity: within(kept.gravity, LIMITS.gravity[0], LIMITS.gravity[1], DEFAULTS.gravity),
    };
}
