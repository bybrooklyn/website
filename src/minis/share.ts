// A marble run to share: the run's text (run.ts), the camera spots kept with it, and the pieces of one's
// own that it uses, as a few lines of plain text. That text is a `.marbles` file as it is, and squeezed
// (the browser's own deflate, as the sand mini's worlds are, worlds.ts) it goes in a link's fragment.
//
//   marbles 1
//   run v3.h0_0_8_0.s2_0_1_8_2...
//   spot 0 100 0 750 620 2200          the point looked at in mm, the turn and tip in thousandths of a radian, the distance in mm
//   own v3.s1_0_0_1_0.c1_1_1_0_1_0 hairpin
//   race 8 417                         the last race: how many marbles, and the number their line is drawn by
//
// Opening takes nothing on trust. The text, the squeezed bytes and what they unsqueeze to are bounded,
// and unsqueezing stops at the bound, so a few bytes that would grow to gigabytes cost no more than it;
// so are the lines, the pieces, every number and every name. Text that is not a shared run at all is
// refused quietly with undefined. A run whose pieces do not all fit (one over another, off the table,
// too high, or not a piece of the box) is put together as far as it fits, in order, and says how many
// were left out.

import { moved, placeKey, type Move } from "./edit";
import { STRAIGHT, type Orbit } from "./orbit";
import { DRAWN, RACE } from "./race";
import { keyOf } from "./pieces";
import { fits, read, write, type Placed } from "./run";
import { canSqueeze, fromText, through, toText } from "./worlds";

/** A piece of one's own: its name and the group as a run's text. */
export interface Own {
    name: string;
    text: string;
}

/** What is shared: the run, its spots, the pieces of one's own it uses, and the race run on it last, if any. */
export interface Shared {
    run: Placed[];
    spots: Orbit[];
    owns: Own[];
    race?: { count: number; drawn: number };
}

/** A shared run opened: the run as far as it fits, how many pieces were left out, its spots and pieces of one's own. */
export interface Opened extends Shared {
    left: number;
}

/** The bounds on what is opened. */
export const MOST = {
    /** Characters of text read at all, from a file, a paste or an unsqueezed link. */
    text: 200_000,
    /** Characters of a link's squeezed text. */
    link: 100_000,
    pieces: 1000,
    spots: 6,
    owns: 12,
    /** Pieces in a piece of one's own, and characters in its name. */
    own: 200,
    name: 30,
    /** Characters in one piece's text, and digits in one number. */
    token: 160,
    digits: 6,
    /** The highest level a piece may stand at: four metres up. */
    level: 200,
};

/** The longest a link's squeezed text may be before the run is saved as a file instead: an address this long is still taken whole by mail and chat. */
export const LINK_MOST = 6000;
/** Where a shared run is in an address: `#run=` and the squeezed text. */
export const LINKED = "#run=";

const HEAD = "marbles 1";
/** A spot's numbers: the point looked at in tenths of a centimetre, the turn and tip in thousandths of a radian, the distance in tenths of a centimetre. */
const spotLine = (spot: Orbit) => `spot ${[spot.at[0] * 10, spot.at[1] * 10, spot.at[2] * 10, spot.turn * 1000, spot.tip * 1000, spot.far * 10].map((value) => Math.round(value)).join(" ")}`;

/** A shared run as its text: the file's text, and what a link squeezes. */
export function writeShared(shared: Shared): string {
    const lines = [HEAD, `run ${write(shared.run)}`, ...shared.spots.slice(0, MOST.spots).map(spotLine), ...shared.owns.slice(0, MOST.owns).map((own) => `own ${own.text} ${cleanName(own.name)}`), ...(shared.race ? [`race ${shared.race.count} ${shared.race.drawn}`] : [])];
    return `${lines.join("\n")}\n`;
}

/** A name as it is kept: printable letters only, spaces evened, no longer than a name may be. */
function cleanName(name: string): string {
    return name.replace(/[\p{C}]/gu, "").replace(/\s+/g, " ").trim().slice(0, MOST.name);
}

/** A whole number written plainly within the bound on digits, or undefined. */
const whole = (text: string): number | undefined => (new RegExp(`^-?\\d{1,${MOST.digits}}$`).test(text) ? Number(text) : undefined);

/** A run's text read piece by piece, each bounded: the pieces read, and how many could not be. Undefined if it is not a run's text at all. */
function readRun(text: string): { run: Placed[]; unread: number } | undefined {
    if (text.length > MOST.text) return undefined;
    const [head, ...tokens] = text.split(".");
    if (head !== "v1" && head !== "v2" && head !== "v3") return undefined;
    if (tokens.length > MOST.pieces) return undefined;
    const run: Placed[] = [];
    let unread = 0;
    for (const token of tokens) {
        // every number within its bound of digits, before anything is made of it
        const numbers = token.slice(1).split(/[_b]/);
        if (token.length > MOST.token || !numbers.every((one) => whole(one) !== undefined)) {
            unread++;
            continue;
        }
        try {
            const [piece] = read(`${head}.${token}`);
            if (piece) run.push({ ...piece, id: run.length + 1 });
        } catch {
            unread++;
        }
    }
    return { run, unread };
}

/** Pieces put together in order as far as they fit: each that fits with those before it is kept (numbered again from 1), and each that does not (over another, off the table or below it, too high) is left out and counted. */
export function fitted(pieces: Placed[]): { run: Placed[]; left: number } {
    const run: Placed[] = [];
    let left = 0;
    for (const piece of pieces) {
        const one = { ...piece, id: run.length + 1 };
        if (piece.place.y <= MOST.level && fits(run, one)) run.push(one);
        else left++;
    }
    return { run, left };
}

/** A spot read from its numbers, if each is within what a camera can be. */
function readSpot(parts: string[]): Orbit | undefined {
    if (parts.length !== 6) return undefined;
    const numbers = parts.map(whole);
    if (numbers.some((one) => one === undefined)) return undefined;
    const [x, y, z, turn, tip, far] = numbers as number[];
    const spot: Orbit = { at: [x! / 10, y! / 10, z! / 10], turn: turn! / 1000, tip: tip! / 1000, far: far! / 10 };
    // within the table, above the ground, any turn once round either way, a tip a view can have, as near or far as a view may be
    const sane = Math.abs(spot.at[0]) <= 300 && Math.abs(spot.at[2]) <= 300 && spot.at[1] >= -10 && spot.at[1] <= 500 && Math.abs(spot.turn) <= 4 * Math.PI && spot.tip >= STRAIGHT[0] && spot.tip <= STRAIGHT[1] && spot.far >= 5 && spot.far <= 900;
    return sane ? spot : undefined;
}

/** A shared run read from its text: a file's, a paste's, or a link's once unsqueezed. A bare run's text is read too. Undefined, quietly, for anything that is not one. */
export function readShared(text: string): Opened | undefined {
    if (text.length > MOST.text) return undefined;
    const lines = text.replace(/\r/g, "").trim().split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 1 && /^v[123](\.|$)/.test(lines[0]!)) {
        const bare = readRun(lines[0]!);
        if (!bare) return undefined;
        const { run, left } = fitted(bare.run);
        return { run, left: left + bare.unread, spots: [], owns: [] };
    }
    if (lines[0] !== HEAD || lines.length > 3 + MOST.spots + MOST.owns) return undefined;
    const runLine = lines[1]?.startsWith("run ") ? readRun(lines[1].slice(4)) : undefined;
    if (!runLine) return undefined;
    const spots: Orbit[] = [];
    const owns: Own[] = [];
    let race: Shared["race"];
    for (const line of lines.slice(2)) {
        const [word, ...rest] = line.split(" ");
        if (word === "spot" && spots.length < MOST.spots) {
            const spot = readSpot(rest);
            if (spot) spots.push(spot);
        } else if (word === "own" && owns.length < MOST.owns) {
            const [ownText, ...name] = rest;
            const group = ownText && readRun(ownText);
            const clean = cleanName(name.join(" "));
            if (group && !group.unread && group.run.length && group.run.length <= MOST.own && clean) owns.push({ name: clean, text: write(group.run) });
        } else if (word === "race" && !race && rest.length === 2) {
            // as many marbles as a race lets go, and a number a line is drawn from
            const [count, drawn] = rest.map(whole);
            if (count !== undefined && drawn !== undefined && count >= RACE[0] && count <= RACE[1] && drawn >= DRAWN[0] && drawn <= DRAWN[1]) race = { count, drawn };
        }
    }
    const { run, left } = fitted(runLine.run);
    return { run, left: left + runLine.unread, spots, owns, ...(race ? { race } : {}) };
}

/** A shared run squeezed for a link's fragment: "z" and the squeezed bytes, or "p" and the bytes as they are where the browser cannot squeeze, in letters an address carries. */
export async function packShared(shared: Shared, squeeze = canSqueeze()): Promise<string> {
    const bytes = new TextEncoder().encode(writeShared(shared));
    const squeezed = squeeze ? await through(bytes, new CompressionStream("deflate-raw"), MOST.text * 4) : undefined;
    return squeezed ? `z${toText(squeezed)}` : `p${toText(bytes)}`;
}

/** A shared run read back from a link's squeezed text, or undefined, quietly, for anything that is not one; unsqueezing stops at the bound. */
export async function unpackShared(packed: string): Promise<Opened | undefined> {
    if (packed.length < 2 || packed.length > MOST.link) return undefined;
    const bytes = fromText(packed.slice(1));
    if (!bytes) return undefined;
    let plain: Uint8Array | undefined;
    if (packed[0] === "p") plain = bytes;
    else if (packed[0] === "z" && canSqueeze()) plain = await through(bytes, new DecompressionStream("deflate-raw"), MOST.text);
    if (!plain || plain.length > MOST.text) return undefined;
    try {
        return readShared(new TextDecoder("utf-8", { fatal: true }).decode(plain));
    } catch {
        return undefined;
    }
}

/** Text that may hold a shared run, as pasted or dropped: a link to one, a file's text, or a bare run's text. */
export async function openText(text: string): Promise<Opened | undefined> {
    if (text.length > MOST.link + 4000) return undefined;
    const at = text.indexOf(LINKED);
    if (at >= 0) return unpackShared(text.slice(at + LINKED.length).trim().split(/[\s&]/)[0]!);
    return readShared(text);
}

/**
 * The pieces of one's own that a run uses: those whose every piece is in the run, the group turned by
 * whole quarters and moved by whole cells and levels as one. A piece of one's own mirrored is not
 * looked for.
 */
export function ownsUsed(run: Placed[], owns: Own[]): Own[] {
    const placed = new Set(run.map((piece) => `${keyOf(piece.kind)} ${placeKey(piece.place)}`));
    return owns.filter((own) => {
        let group: Placed[];
        try {
            group = read(own.text);
        } catch {
            return false;
        }
        const first = group[0];
        if (!first) return false;
        for (const piece of run) {
            if (keyOf(piece.kind) !== keyOf(first.kind)) continue;
            for (let turn = 0; turn < 4; turn++) {
                const turned = moved(first, { turn, x: 0, z: 0, y: 0 });
                if (turned.place.turn !== piece.place.turn) continue;
                const move: Move = { turn, x: piece.place.x - turned.place.x, z: piece.place.z - turned.place.z, y: piece.place.y - turned.place.y };
                if (group.every((one) => placed.has(`${keyOf(one.kind)} ${placeKey(moved(one, move).place)}`))) return true;
            }
        }
        return false;
    });
}
