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
