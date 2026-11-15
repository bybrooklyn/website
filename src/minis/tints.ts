// What the pile of blocks lets a visitor choose, as plain arithmetic: which kind of piece is dropped,
// a piece's color from a hue and a darkness, the hue under a point on the color wheel, and which piece
// a press of Backspace takes away. blocks.ts draws and asks; nothing here touches the page.

/** A kind of piece to drop: any of them, or one in particular. */
export type Kind = "any" | "block" | "ball" | "wedge";

/** The kinds in the order the panel shows them, each with what its button is called. */
export const KINDS: { kind: Kind; name: string }[] = [
    { kind: "any", name: "Any piece" },
    { kind: "block", name: "Block" },
    { kind: "ball", name: "Ball" },
    { kind: "wedge", name: "Wedge" },
];

/** The kind dropped for a choice: the one chosen, or for "any" mostly a block and now and then a ball or a wedge, by a number from 0 to 1. */
export function kindFor(choice: Kind, chance: number): Exclude<Kind, "any"> {
    if (choice !== "any") return choice;
    return chance < 0.7 ? "block" : chance < 0.85 ? "ball" : "wedge";
}

/** A hue brought into 0 to 360 degrees. */
export const turned = (hue: number): number => ((hue % 360) + 360) % 360;

/** A darkness held to 0 (the site's soft pastel) through 1 (deep). */
export const held = (dark: number): number => Math.min(1, Math.max(0, Number.isFinite(dark) ? dark : 0));

/** A piece's color at a hue in degrees and a darkness from 0 to 1. At no darkness it is the soft color the pile has always had; darker, it keeps its hue and gains a little color so that it does not go gray. */
export function tint(hue: number, dark = 0): string {
    const d = held(dark);
    return `oklch(${(0.86 - 0.5 * d).toFixed(3)} ${(0.085 + 0.03 * d).toFixed(3)} ${Math.round(turned(hue)) % 360})`;
}

/** Whether a piece this dark wants its line (a ball's spoke) drawn light, to be seen on it. */
export const deep = (dark: number): boolean => held(dark) > 0.45;

/** The hue under a point on the wheel whose middle is at (cx, cy): 0 at the top, growing clockwise, in whole degrees. */
export function hueAt(x: number, y: number, cx: number, cy: number): number {
    return Math.round(turned((Math.atan2(x - cx, cy - y) * 180) / Math.PI)) % 360;
}

/** Where on the wheel a hue sits, as a unit step from its middle: 0 degrees at the top, growing clockwise. */
export function placeOf(hue: number): [number, number] {
    const angle = (turned(hue) * Math.PI) / 180;
    return [Math.sin(angle), -Math.cos(angle)];
}

/** Which piece a remove takes away: the one held, else the one under the pointer, else the newest of the pile; nothing from an empty pile. */
export function toRemove<T>(pile: readonly T[], inHand?: T, under?: T): T | undefined {
    if (inHand !== undefined && pile.includes(inHand)) return inHand;
    if (under !== undefined && pile.includes(under)) return under;
    return pile.at(-1);
}

/** What is kept between visits, read back taking nothing on trust. */
export function choices(kept: unknown): { kind: Kind; hue: number | undefined; dark: number } {
    const from = (kept && typeof kept === "object" ? kept : {}) as { kind?: unknown; hue?: unknown; dark?: unknown };
    const kind = KINDS.find((each) => each.kind === from.kind)?.kind ?? "any";
    const hue = typeof from.hue === "number" && Number.isFinite(from.hue) ? Math.round(turned(from.hue)) % 360 : undefined;
    return { kind, hue, dark: typeof from.dark === "number" ? held(from.dark) : 0 };
}
