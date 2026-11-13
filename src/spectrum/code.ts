// Share codes: every slider's value in eight characters, for `/spectrum/?c=<code>`.
//
// The nine values (each 0 to 17, 0 for unset) are the digits of one number in base 18, in the
// order of `axes`, and that number is written in base 62, padded with zeros to eight characters.
//
// Two older kinds still open, and a code's length says which it is. Six characters held nine
// sliders of nine positions, as a nine-digit decimal number in base 62. Seven characters are the
// old app's, eleven sliders the same way, whose last two (the sliders taken out) are dropped. A
// value v from either is the position 2v - 1 of the seventeen.

import { axes, HIGHEST, UNSET, widened, type Values } from "./axes";

export const LENGTH = 8;
/** Nine sliders of nine positions. */
const NINE_LENGTH = 6;
/** The old app's eleven sliders of nine positions. */
const OLD_LENGTH = 7;
const BASE = HIGHEST + 1;
const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A whole number written in base 62, padded with zeros to `length`. */
function written(number: number, length: number): string {
    let text = "";
    for (let rest = number; rest > 0; rest = Math.floor(rest / 62)) text = DIGITS[rest % 62] + text;
    return text.padStart(length, "0");
}

/** A base 62 number read back, or undefined if a character is not one of its digits. */
function read(text: string): number | undefined {
    let number = 0;
    for (const character of text) {
        const digit = DIGITS.indexOf(character);
        if (digit < 0) return undefined;
        number = number * 62 + digit;
    }
    return number;
}

/** The code for these values. Anything that is not a whole number from 0 to 17 is written as unset. */
export function encode(values: Values): string {
    const number = axes.reduce((sum, _, index) => {
        const value = values[index] ?? UNSET;
        return sum * BASE + (Number.isInteger(value) && value >= 0 && value <= HIGHEST ? value : UNSET);
    }, 0);
    return written(number, LENGTH);
}

/** A code of nine positions read the old way: its decimal digits, the first nine of them. */
function nines(code: string, sliders: number): Values | undefined {
    const number = read(code);
    if (number === undefined || number >= 10 ** sliders) return undefined;
    return [...String(number).padStart(sliders, "0")].slice(0, axes.length).map((digit) => widened(Number(digit)));
}

/** The values a code holds, of any of the three kinds, or undefined for something that is not a code. */
export function decode(code: string): Values | undefined {
    if (code.length === NINE_LENGTH) return nines(code, axes.length);
    if (code.length === OLD_LENGTH) return nines(code, 11);
    if (code.length !== LENGTH) return undefined;
    let number = read(code);
    if (number === undefined || number >= BASE ** axes.length) return undefined;
    const values: Values = [];
    for (let index = 0; index < axes.length; index++) {
        values.unshift(number % BASE);
        number = Math.floor(number / BASE);
    }
    return values;
}
