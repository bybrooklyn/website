// The arithmetic QR codes protect their bytes with: the field of 256 numbers that QR Code's Reed-Solomon
// codes are worked in (made from the polynomial x^8 + x^4 + x^3 + x^2 + 1, 0x11d, with 2 as its
// generator), the check bytes added to a block (`checkBytes`), and the repair of a block read with some
// bytes wrong (`repair`: the syndromes, Berlekamp and Massey's search for where the errors are, Chien's
// trial of every place, and Forney's sizes of the errors). The generator's roots are 2^0, 2^1 and on,
// as ISO/IEC 18004 has them.
//
//   const block = [...data, ...checkBytes(data, 10)];
//   const fixed = repair(readBack, 10); // the data and check bytes put right, or undefined

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
    let value = 1;
    for (let power = 0; power < 255; power++) {
        EXP[power] = value;
        LOG[value] = power;
        value <<= 1;
        if (value & 0x100) value ^= 0x11d;
    }
    // doubled, so that a sum of two logarithms needs no wrapping
    for (let power = 255; power < 512; power++) EXP[power] = EXP[power - 255]!;
}

/** The product of two numbers of the field. */
export function times(a: number, b: number): number {
    return a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!;
}

/** 2 raised to a power, in the field. */
export function power(exponent: number): number {
    return EXP[((exponent % 255) + 255) % 255]!;
}

/** The number that a number multiplies to 1 with; 0 has none. */
export function inverse(a: number): number {
    if (a === 0) throw new Error("0 has no inverse");
    return EXP[255 - LOG[a]!]!;
}

const generators = new Map<number, Uint8Array>();
/** The generator polynomial of `count` check bytes, (x - 2^0)(x - 2^1)...(x - 2^(count-1)), highest power first, its leading 1 left off. */
export function generator(count: number): Uint8Array {
    const kept = generators.get(count);
    if (kept) return kept;
    let poly = [1];
    for (let root = 0; root < count; root++) {
        const next = new Array<number>(poly.length + 1).fill(0);
        for (let at = 0; at < poly.length; at++) {
            next[at]! ^= poly[at]!;
            next[at + 1]! ^= times(poly[at]!, power(root));
        }
        poly = next;
    }
    const made = Uint8Array.from(poly.slice(1));
    generators.set(count, made);
    return made;
}

/** The `count` check bytes of a block of data: the remainder of the data, shifted up by `count`, divided by the generator. */
export function checkBytes(data: ArrayLike<number>, count: number): Uint8Array {
    const divisor = generator(count);
    const rest = new Uint8Array(count);
    for (let at = 0; at < data.length; at++) {
        const factor = data[at]! ^ rest[0]!;
        rest.copyWithin(0, 1);
        rest[count - 1] = 0;
        for (let each = 0; each < count; each++) rest[each]! ^= times(divisor[each]!, factor);
    }
    return rest;
}

/** A polynomial's value at a point, its coefficients highest power first. */
function valueAt(poly: ArrayLike<number>, x: number): number {
    let sum = 0;
    for (let at = 0; at < poly.length; at++) sum = times(sum, x) ^ poly[at]!;
    return sum;
}

/**
 * A block read back (data then `count` check bytes) put right, or undefined when it has more errors
 * than its check bytes can mend (at most `count / 2`). The block given is not changed; with no errors
 * it comes back as it was. `errors` in the answer says how many bytes were mended.
 */
export function repair(block: ArrayLike<number>, count: number): { bytes: Uint8Array; errors: number } | undefined {
    const bytes = Uint8Array.from(block as ArrayLike<number>);
    const n = bytes.length;
    // the syndromes: the block's value at each root of the generator; all nothing when it is whole
    const syndromes = new Uint8Array(count);
    let whole = true;
    for (let root = 0; root < count; root++) {
        syndromes[root] = valueAt(bytes, power(root));
        if (syndromes[root]) whole = false;
    }
    if (whole) return { bytes, errors: 0 };
    // Berlekamp and Massey: the shortest error locator that makes the syndromes, lowest power first
    let locator = [1];
    let previous = [1];
    let length = 0;
    let shift = 1;
    let lastStep = 1;
    for (let step = 0; step < count; step++) {
        let discrepancy = syndromes[step]!;
        for (let at = 1; at <= length; at++) discrepancy ^= times(locator[at] ?? 0, syndromes[step - at]!);
        if (discrepancy === 0) {
            shift++;
            continue;
        }
        const scale = times(discrepancy, inverse(lastStep));
        const next = locator.slice();
        for (let at = 0; at < previous.length; at++) {
            while (next.length <= at + shift) next.push(0);
            next[at + shift]! ^= times(scale, previous[at]!);
        }
        if (2 * length <= step) {
            previous = locator;
            length = step + 1 - length;
            lastStep = discrepancy;
            shift = 1;
        } else shift++;
        locator = next;
    }
    while (locator.length > 1 && locator[locator.length - 1] === 0) locator.pop();
    const errorCount = locator.length - 1;
    if (errorCount * 2 > count) return undefined;
    // Chien: the places whose inverse is a root of the locator; place p (from the block's end) is 2^p
    const places: number[] = [];
    for (let p = 0; p < n; p++) {
        let sum = 0;
        const x = power(-p);
        for (let at = locator.length - 1; at >= 0; at--) sum = times(sum, x) ^ locator[at]!;
        if (sum === 0) places.push(p);
    }
    if (places.length !== errorCount) return undefined;
    // Forney: the evaluator is the syndromes times the locator, kept below the count
    const evaluator = new Array<number>(count).fill(0);
    for (let i = 0; i < count; i++) for (let j = 0; j < locator.length && i + j < count; j++) evaluator[i + j]! ^= times(syndromes[i]!, locator[j]!);
    for (const p of places) {
        const xInverse = power(-p);
        let top = 0;
        for (let at = evaluator.length - 1; at >= 0; at--) top = times(top, xInverse) ^ evaluator[at]!;
        // the locator's derivative: in this field only its odd powers remain
        let bottom = 0;
        for (let at = 1; at < locator.length; at += 2) bottom ^= times(locator[at]!, power(-p * (at - 1)));
        if (bottom === 0) return undefined;
        const size = times(times(top, inverse(bottom)), power(p));
        bytes[n - 1 - p]! ^= size;
    }
    // what was mended must now be whole, or the guess was wrong
    for (let root = 0; root < count; root++) if (valueAt(bytes, power(root))) return undefined;
    return { bytes, errors: errorCount };
}
