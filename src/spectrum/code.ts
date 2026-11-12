// Share codes: every slider's value in six characters, for `/spectrum/?c=<code>`.
//
// The nine values (each 0 to 9, 0 for unset) are read as one nine-digit number, in the order of
// `axes`, and that number is written in base 62. It always fits in six characters, and is padded
// with zeros to six. This is the scheme of the old app, made for nine sliders where it had eleven.
//
// The old app's codes were seven characters for its eleven sliders, so a code's length says which
// it is. An old code is read the old way and its last two values, the sliders taken out, are dropped.

import { axes, UNSET, type Values } from "./axes";

export const LENGTH = 6;
/** The length of the old eleven-slider codes. */
export const OLD_LENGTH = 7;
const OLD_SLIDERS = 11;
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

/** The code for these values. Anything that is not a whole number from 0 to 9 is written as unset. */
export function encode(values: Values): string {
    const digits = axes.map((_, index) => {
        const value = values[index] ?? UNSET;
        return Number.isInteger(value) && value >= 0 && value <= 9 ? value : UNSET;
    });
    return written(Number(digits.join("")), LENGTH);
}

/** The values a code holds, new or old, or undefined for something that is not a code. */
export function decode(code: string): Values | undefined {
    const sliders = code.length === LENGTH ? axes.length : code.length === OLD_LENGTH ? OLD_SLIDERS : 0;
    const number = sliders ? read(code) : undefined;
    if (number === undefined || number >= 10 ** sliders) return undefined;
    // An old code's first nine digits are the nine sliders that are kept, in the same order.
    return [...String(number).padStart(sliders, "0")].slice(0, axes.length).map(Number);
}
