// The sliders of Spectrum, in the order they are shown and written into a share code, and how
// they are gathered into the corners of the chart. After Andrea Vos's Spectrum (see LICENSE.md),
// with two of its eleven sliders taken out.

/** Every slider, in order. A slider's place in this list is its place in a share code. */
export const axes = ["genderIdentity", "genderExpression", "sexualOrientation", "romanticOrientation", "sexualAttraction", "sexualDrive", "romanticDesire", "relationshipAttitude", "genderComfort"] as const;

export type Axis = (typeof axes)[number];

/** One value for each slider, in the order of `axes`: 1 to 9, or 0 for a slider left unset. */
export type Values = number[];

export const LOWEST = 1;
export const HIGHEST = 9;
export const MIDDLE = 5;
export const UNSET = 0;

/** Where every slider starts: in the middle. */
export const start = (): Values => axes.map(() => MIDDLE);

/** A value a slider can hold, or unset for anything else. */
export const kept = (value: number): number => (Number.isInteger(value) && value >= LOWEST && value <= HIGHEST ? value : UNSET);

/** The corners of the chart. Each is the mean of the sliders under it that are set. */
export const groups: { key: string; members: Axis[] }[] = [
    { key: "genderSelf", members: ["genderIdentity", "genderComfort"] },
    { key: "expression", members: ["genderExpression"] },
    { key: "orientation", members: ["sexualOrientation", "romanticOrientation"] },
    { key: "desire", members: ["sexualAttraction", "sexualDrive", "romanticDesire"] },
    { key: "relationships", members: ["relationshipAttitude"] },
];
