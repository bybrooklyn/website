// The sliders of Spectrum, in the order they are shown and written into a share code. After
// Andrea Vos's Spectrum (see LICENSE.md), with two of its eleven sliders taken out.
//
// Each slider has seventeen positions: the original's nine, and one halfway between each pair.

/** Every slider, in order. A slider's place in this list is its place in a share code. */
export const axes = ["genderIdentity", "genderExpression", "sexualOrientation", "romanticOrientation", "sexualAttraction", "sexualDrive", "romanticDesire", "relationshipAttitude", "genderComfort"] as const;

export type Axis = (typeof axes)[number];

/** One value for each slider, in the order of `axes`: 1 to 17, or 0 for a slider left unset. */
export type Values = number[];

export const LOWEST = 1;
export const HIGHEST = 17;
export const MIDDLE = 9;
export const UNSET = 0;

/** Where every slider starts: in the middle. */
export const start = (): Values => axes.map(() => MIDDLE);

/** A value a slider can hold, or unset for anything else. */
export const kept = (value: number): number => (Number.isInteger(value) && value >= LOWEST && value <= HIGHEST ? value : UNSET);

/** A value from the original's nine positions as one of the seventeen: v becomes 2v - 1, and unset stays unset. */
export const widened = (value: number): number => (value >= 1 && value <= 9 ? 2 * value - 1 : UNSET);
