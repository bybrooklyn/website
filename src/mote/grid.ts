// Mote's broad phase: which pairs of bodies are near enough to be worth a closer look. Both kinds
// of physics use it, in two or three dimensions. Each body is given a box that it cannot reach out
// of this step; the pairs whose boxes overlap are handed back in the order a loop over every pair
// would have met them (by the first body's number, then the second's), so that the solver, which
// cares about order, does exactly what it did when it looked at every pair.
//
//   const grid = new Grid(2);
//   grid.ready(count);                         // then fill grid.low, grid.high and grid.moves
//   grid.find(count);
//   for (let i = 0; i < count; i++)
//       for (let k = grid.start[i]!; k < grid.start[i + 1]!; k++) look(i, grid.other[k]!);
//
// How. The world is cut into cubes (squares, in 2D) about the size of a moving body's box, and each
// body is listed under every cube its box covers, in a table found by a hash of the cube's place;
// two bodies under the same cube are a pair. A body that would cover more than a few cubes (a
// floor, a wall, a long ramp) is kept out of the table and set against every other body instead:
// the minis have few of those and many small things that move. Nothing is made anew in a step
// once the arrays have grown to the size the scene needs.

/** How pairs that may touch are found: the grid below, or in a test every pair. */
export interface Pairs {
    /** Each body's box, its least corner and its greatest, two or three numbers a body. */
    low: Float64Array;
    high: Float64Array;
    /** 1 for a body that moves or may be woken this step; a pair of two that do not is left out. */
    moves: Uint8Array;
    /** For body `i`, its pairs are `other[start[i]]` up to but not including `other[start[i + 1]]`, each greater than `i`, rising. */
    start: Int32Array;
    other: Int32Array;
    /** Makes room for this many bodies. The arrays above may be new afterwards. */
    ready(count: number): void;
    /** Finds the pairs of the first `count` bodies. */
    find(count: number): void;
}

/** A body that would be listed under more cubes than this is set against every body instead. */
const MOST = 16;
/** A cube's number along an axis is kept below this, so that it fits in a whole number. */
const FAR = 2 ** 30;

const floats = (size: number) => new Float64Array(size);
const whole = (size: number) => new Int32Array(size);
const bytes = (size: number) => new Uint8Array(size);

/** Room for at least `count`: the same array if it is big enough, otherwise one twice as big as needed. */
function room<T extends Int32Array | Float64Array | Uint8Array>(array: T, count: number, make: (size: number) => T): T {
    return array.length >= count ? array : make(Math.max(16, count * 2));
}

/** Which cube along one axis a value is in. */
const cell = (value: number, side: number) => Math.floor(value / side) | 0;

/** The table's slot for a cube. */
const hash = (x: number, y: number, z: number, mask: number) => (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)) & mask;

/** The broad phase: a hashed grid of cubes, with large bodies kept apart. */
export class Grid implements Pairs {
    readonly dims: 2 | 3;
    low = floats(0);
    high = floats(0);
    moves = bytes(0);
    start = whole(1);
    other = whole(0);
    /** The pairs as found, before they are put in order. */
    #first = whole(0);
    #second = whole(0);
    #pairs = 0;
    /** Bodies too large for the table, by number, rising. */
    #large = whole(0);
    /** The table: where each slot's entries begin in the lists below, and one more for where the last ends. */
    #slots = whole(0);
    /** Each entry: which body, and the cube it is listed under. */
    #body = whole(0);
    #cube = whole(0);
    /** Where the next pair of each body goes, while they are put in order. */
    #cursor = whole(0);

    /** A grid for bodies in two or in three dimensions. */
    constructor(dims: 2 | 3) {
        this.dims = dims;
    }

    ready(count: number): void {
        const d = this.dims;
        this.low = room(this.low, count * d, floats);
        this.high = room(this.high, count * d, floats);
        this.moves = room(this.moves, count, bytes);
        this.start = room(this.start, count + 1, whole);
        this.#large = room(this.#large, count, whole);
        this.#cursor = room(this.#cursor, count, whole);
    }

    find(count: number): void {
        const { low, high, moves } = this;
        const d = this.dims;
        this.#pairs = 0;
        // The cube's side: the mean size of a moving body's box.
        let sum = 0;
        let moving = 0;
        for (let i = 0; i < count; i++) {
            if (!moves[i] || !(low[i * d]! <= high[i * d]!)) continue;
            let most = 0;
            for (let axis = 0; axis < d; axis++) most = Math.max(most, high[i * d + axis]! - low[i * d + axis]!);
            sum += most;
            moving++;
        }
        if (moving) this.#table(count, sum / moving || 1);
        this.#order(count);
    }

    /** Keeps a pair found, the lower number first. */
    #keep(i: number, j: number): void {
        if (this.#pairs >= this.#first.length) {
            const first = whole(Math.max(64, this.#pairs * 2));
            const second = whole(Math.max(64, this.#pairs * 2));
            first.set(this.#first);
            second.set(this.#second);
            this.#first = first;
            this.#second = second;
        }
        this.#first[this.#pairs] = i < j ? i : j;
        this.#second[this.#pairs] = i < j ? j : i;
        this.#pairs++;
    }

    /** Whether two bodies' boxes overlap. */
    #overlap(i: number, j: number): boolean {
        const { low, high } = this;
        const d = this.dims;
        for (let axis = 0; axis < d; axis++) if (low[i * d + axis]! > high[j * d + axis]! || low[j * d + axis]! > high[i * d + axis]!) return false;
        return true;
    }

    /** Lists each small body under the cubes its box covers, finds the pairs that share a cube, then sets the large bodies against all. */
    #table(count: number, side: number): void {
        const { low, high, moves } = this;
        const d = this.dims;
        const three = d === 3;
        let entries = 0;
        let large = 0;
        for (let i = 0; i < count; i++) {
            // an empty box (a body with no shape) is in no pair
            if (!(low[i * d]! <= high[i * d]!)) continue;
            let covers = 1;
            for (let axis = 0; axis < d; axis++) {
                const from = low[i * d + axis]! / side;
                const to = high[i * d + axis]! / side;
                // so far out that its cube's number would not fit: set against all, as a large one is
                covers *= from > -FAR && to < FAR ? Math.floor(to) - Math.floor(from) + 1 : Infinity;
            }
            if (covers > MOST) this.#large[large++] = i;
            else entries += covers;
        }
        let size = 16;
        while (size < entries * 2) size *= 2;
        const mask = size - 1;
        this.#slots = room(this.#slots, size + 1, whole);
        this.#body = room(this.#body, entries, whole);
        this.#cube = room(this.#cube, entries * d, whole);
        const slots = this.#slots;
        const body = this.#body;
        const cube = this.#cube;
        const largest = this.#large;
        slots.fill(0, 0, size + 1);
        // Twice over the bodies: once to count how many entries each slot has, once to put them there.
        for (let pass = 0; pass < 2; pass++) {
            let next = 0;
            for (let i = 0; i < count; i++) {
                if (!(low[i * d]! <= high[i * d]!)) continue;
                if (next < large && largest[next] === i) {
                    next++;
                    continue;
                }
                const x0 = cell(low[i * d]!, side);
                const y0 = cell(low[i * d + 1]!, side);
                const z0 = three ? cell(low[i * d + 2]!, side) : 0;
                const x1 = cell(high[i * d]!, side);
                const y1 = cell(high[i * d + 1]!, side);
                const z1 = three ? cell(high[i * d + 2]!, side) : 0;
                for (let z = z0; z <= z1; z++) {
                    for (let y = y0; y <= y1; y++) {
                        for (let x = x0; x <= x1; x++) {
                            const slot = hash(x, y, z, mask);
                            if (!pass) {
                                slots[slot + 1]!++;
                                continue;
                            }
                            const at = slots[slot]!++;
                            body[at] = i;
                            cube[at * d] = x;
                            cube[at * d + 1] = y;
                            if (three) cube[at * d + 2] = z;
                        }
                    }
                }
            }
            // After counting, each slot's start. After filling, each start has moved on to the next
            // slot's, so each is put back one place.
            if (!pass) for (let slot = 0; slot < size; slot++) slots[slot + 1]! += slots[slot]!;
            else for (let slot = size; slot > 0; slot--) slots[slot] = slots[slot - 1]!;
        }
        slots[0] = 0;

        for (let slot = 0; slot < size; slot++) {
            const to = slots[slot + 1]!;
            for (let p = slots[slot]!; p < to; p++) {
                const i = body[p]!;
                for (let q = p + 1; q < to; q++) {
                    const j = body[q]!;
                    if (i === j || (!moves[i] && !moves[j])) continue;
                    // two cubes can share a slot: only the same cube counts
                    let same = true;
                    for (let axis = 0; axis < d && same; axis++) same = cube[p * d + axis] === cube[q * d + axis];
                    if (!same || !this.#overlap(i, j)) continue;
                    // Two bodies may share several cubes: the pair is kept only under the one that holds
                    // the least corner of where their boxes overlap, so that it is kept once.
                    let here = true;
                    for (let axis = 0; axis < d && here; axis++) here = cell(Math.max(low[i * d + axis]!, low[j * d + axis]!), side) === cube[p * d + axis];
                    if (here) this.#keep(i, j);
                }
            }
        }
        for (let k = 0; k < large; k++) {
            const i = largest[k]!;
            let next = 0;
            for (let j = 0; j < count; j++) {
                const other = next < large && largest[next] === j;
                if (other) next++;
                // a large body against another large one only once
                if (j === i || (other && j < i) || (!moves[i] && !moves[j]) || !(low[j * d]! <= high[j * d]!)) continue;
                if (this.#overlap(i, j)) this.#keep(i, j);
            }
        }
    }

    /** Puts the pairs in the order a loop over every pair would meet them: by first body, then by second. */
    #order(count: number): void {
        const start = this.start;
        const first = this.#first;
        const second = this.#second;
        const pairs = this.#pairs;
        this.other = room(this.other, pairs, whole);
        const other = this.other;
        const cursor = this.#cursor;
        // counted by first body, then each body's pairs put in a run of their own
        start.fill(0, 0, count + 1);
        for (let k = 0; k < pairs; k++) start[first[k]! + 1]!++;
        for (let i = 0; i < count; i++) start[i + 1]! += start[i]!;
        for (let i = 0; i < count; i++) cursor[i] = start[i]!;
        for (let k = 0; k < pairs; k++) other[cursor[first[k]!]!++] = second[k]!;
        for (let i = 0; i < count; i++) {
            // A body has few pairs, and a large body's come already in order, so a plain insertion sort is quickest.
            const from = start[i]!;
            const to = start[i + 1]!;
            for (let k = from + 1; k < to; k++) {
                const value = other[k]!;
                let at = k - 1;
                while (at >= from && other[at]! > value) {
                    other[at + 1] = other[at]!;
                    at--;
                }
                other[at + 1] = value;
            }
        }
    }
}

/**
 * A table for things that never move, such as the chunks of fixed track: filled once, then asked
 * which of them a box reaches. It is kept apart from the grid above, which is made again each step,
 * so that a long run of track costs nothing until a ball comes near a piece of it.
 *
 *   const kept = new Kept();
 *   kept.add(low, high);                       // each thing's box, as three numbers each
 *   kept.build();
 *   const count = kept.find(low, high);        // then kept.found[0] up to count, rising
 */
export class Kept {
    #low: number[] = [];
    #high: number[] = [];
    #side = 1;
    #mask = 0;
    /** The table: where each slot's entries begin in the lists below, and one more for where the last ends. */
    #slots = whole(1);
    #entry = whole(0);
    #cube = whole(0);
    /** Things too large for the table, looked at for every box. */
    #large: number[] = [];
    /** Which search last found each thing, so that it is counted once. */
    #seen = new Uint32Array(0);
    #search = 0;
    /** What the last search found, by number, rising. */
    found = whole(16);

    /** How many things are kept. */
    get count(): number {
        return this.#low.length / 3;
    }

    /** Keeps a thing by its box, and returns its number. `build` must be called before it can be found. */
    add(low: ArrayLike<number>, high: ArrayLike<number>): number {
        this.#low.push(low[0]!, low[1]!, low[2]!);
        this.#high.push(high[0]!, high[1]!, high[2]!);
        return this.count - 1;
    }

    /** Forgets everything kept. */
    clear(): void {
        this.#low = [];
        this.#high = [];
        this.build();
    }

    /** Lists each thing under the cubes its box covers, the cube's side the mean size of a box. */
    build(): void {
        const count = this.count;
        const low = this.#low;
        const high = this.#high;
        let sum = 0;
        for (let i = 0; i < count; i++) sum += Math.max(high[i * 3]! - low[i * 3]!, high[i * 3 + 1]! - low[i * 3 + 1]!, high[i * 3 + 2]! - low[i * 3 + 2]!);
        const side = count ? sum / count || 1 : 1;
        this.#side = side;
        this.#large = [];
        const listed: [entry: number, x: number, y: number, z: number][] = [];
        for (let i = 0; i < count; i++) {
            const [x0, y0, z0] = [cell(low[i * 3]!, side), cell(low[i * 3 + 1]!, side), cell(low[i * 3 + 2]!, side)];
            const [x1, y1, z1] = [cell(high[i * 3]!, side), cell(high[i * 3 + 1]!, side), cell(high[i * 3 + 2]!, side)];
            if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > MOST * 4) {
                this.#large.push(i);
                continue;
            }
            for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) listed.push([i, x, y, z]);
        }
        let size = 16;
        while (size < listed.length * 2) size *= 2;
        this.#mask = size - 1;
        const slots = whole(size + 1);
        for (const [, x, y, z] of listed) slots[hash(x, y, z, this.#mask) + 1]!++;
        for (let slot = 0; slot < size; slot++) slots[slot + 1]! += slots[slot]!;
        const next = slots.slice(0, size);
        this.#entry = whole(listed.length);
        this.#cube = whole(listed.length * 3);
        for (const [i, x, y, z] of listed) {
            const at = next[hash(x, y, z, this.#mask)]!++;
            this.#entry[at] = i;
            [this.#cube[at * 3], this.#cube[at * 3 + 1], this.#cube[at * 3 + 2]] = [x, y, z];
        }
        this.#slots = slots;
        this.#seen = new Uint32Array(count);
        this.#search = 0;
    }

    /** Finds every thing whose box overlaps the box from `low` to `high`, into `found`, by number rising. Returns how many. */
    find(low: ArrayLike<number>, high: ArrayLike<number>): number {
        const side = this.#side;
        const kl = this.#low;
        const kh = this.#high;
        const seen = this.#seen;
        this.#search = (this.#search + 1) >>> 0;
        if (this.#search === 0) {
            seen.fill(0);
            this.#search = 1;
        }
        const search = this.#search;
        let count = 0;
        const take = (i: number) => {
            if (seen[i] === search) return;
            seen[i] = search;
            for (let axis = 0; axis < 3; axis++) if (kl[i * 3 + axis]! > high[axis]! || low[axis]! > kh[i * 3 + axis]!) return;
            if (count >= this.found.length) {
                const more = whole(this.found.length * 2);
                more.set(this.found);
                this.found = more;
            }
            this.found[count++] = i;
        };
        for (const i of this.#large) take(i);
        const [x0, y0, z0] = [cell(low[0]!, side), cell(low[1]!, side), cell(low[2]!, side)];
        const [x1, y1, z1] = [cell(high[0]!, side), cell(high[1]!, side), cell(high[2]!, side)];
        // a box too large to go cube by cube is set against every thing
        if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > MOST * 4) for (let i = 0; i < this.count; i++) take(i);
        else {
            for (let z = z0; z <= z1; z++) {
                for (let y = y0; y <= y1; y++) {
                    for (let x = x0; x <= x1; x++) {
                        const slot = hash(x, y, z, this.#mask);
                        for (let p = this.#slots[slot]!; p < this.#slots[slot + 1]!; p++) {
                            if (this.#cube[p * 3] === x && this.#cube[p * 3 + 1] === y && this.#cube[p * 3 + 2] === z) take(this.#entry[p]!);
                        }
                    }
                }
            }
        }
        // few are found, so a plain insertion sort puts them in order
        const found = this.found;
        for (let k = 1; k < count; k++) {
            const value = found[k]!;
            let at = k - 1;
            while (at >= 0 && found[at]! > value) {
                found[at + 1] = found[at]!;
                at--;
            }
            found[at + 1] = value;
        }
        return count;
    }
}
