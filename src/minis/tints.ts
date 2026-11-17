// What the pile of blocks lets a visitor choose, as plain arithmetic: which kind of piece is dropped,
// a piece's color from a hue and a darkness, the colors along the two bars that pick them, and which
// piece a press of Backspace takes away. blocks.ts draws and asks; nothing here touches the page.

/** A kind of piece to drop: any of them, or one in particular. */
export type Kind = "any" | "block" | "ball" | "wedge";

/** The kinds in the order the column shows them; each is named on the page by its own word. */
export const KINDS: Kind[] = ["any", "block", "ball", "wedge"];

/** The kind dropped for a choice: the one chosen, or for "any" mostly a block and now and then a ball or a wedge, by a number from 0 to 1. */
export function kindFor(choice: Kind, chance: number): Exclude<Kind, "any"> {
    if (choice !== "any") return choice;
    return chance < 0.7 ? "block" : chance < 0.85 ? "ball" : "wedge";
}

/** A hue brought into 0 to 360 degrees. */
export const turned = (hue: number): number => ((hue % 360) + 360) % 360;

/** A darkness held to 0 (the site's soft pastel) through 1 (deep). */
export const held = (dark: number): number => Math.min(1, Math.max(0, Number.isFinite(dark) ? dark : 0));

/** How light a piece is at a darkness, and how much color it has: darker, it gains a little color so that it does not go grey. */
const tone = (dark: number): [number, number] => [0.86 - 0.5 * held(dark), 0.085 + 0.03 * held(dark)];

/** A piece's color at a hue in degrees and a darkness from 0 to 1. At no darkness it is the soft color the pile has always had; darker, it keeps its hue. */
export function tint(hue: number, dark = 0): string {
    const [light, color] = tone(dark);
    return `oklch(${light.toFixed(3)} ${color.toFixed(3)} ${Math.round(turned(hue)) % 360})`;
}

/** A piece of no hue in particular at a darkness: what the bar of darkness runs through while every piece has a hue by chance. */
export const grey = (dark: number): string => `oklch(${tone(dark)[0].toFixed(3)} 0.020 300)`;

/** The most a bar of hues can say: one short of a whole turn, where the first hue comes round again. */
export const HUES = 359;

/** Every hue in a row at a darkness, from the bar's one end to its other. */
export const hues = (dark: number): string[] => Array.from({ length: 13 }, (_, index) => tint((HUES * index) / 12, dark));

/** A hue from light to dark, or with no hue the greys, from the bar's one end to its other. */
export const tones = (hue: number | undefined): string[] => [0, 0.25, 0.5, 0.75, 1].map((dark) => (hue === undefined ? grey(dark) : tint(hue, dark)));

/** Half the width of a bar's handle, in rem. */
export const HANDLE = 0.55;

/** A bar's colors as a CSS picture from left to right, laid between the two places the handle's middle can reach, so that the color under the handle is the color it picks. */
export function ramp(colors: string[]): string {
    const last = Math.max(1, colors.length - 1);
    return `linear-gradient(to right, ${colors.map((color, index) => `${color} calc(${HANDLE}rem + (100% - ${HANDLE * 2}rem) * ${(index / last).toFixed(4)})`).join(", ")})`;
}

/** Whether a piece this dark wants its line (a ball's spoke) drawn light, to be seen on it. */
export const deep = (dark: number): boolean => held(dark) > 0.45;

/** Which piece a remove takes away: the one held, else the one under the pointer, else the newest of the pile; nothing from an empty pile. */
export function toRemove<T>(pile: readonly T[], inHand?: T, under?: T): T | undefined {
    if (inHand !== undefined && pile.includes(inHand)) return inHand;
    if (under !== undefined && pile.includes(under)) return under;
    return pile.at(-1);
}

/** What is kept between visits, read back taking nothing on trust. */
export function choices(kept: unknown): { kind: Kind; hue: number | undefined; dark: number } {
    const from = (kept && typeof kept === "object" ? kept : {}) as { kind?: unknown; hue?: unknown; dark?: unknown };
    const kind = KINDS.find((each) => each === from.kind) ?? "any";
    const hue = typeof from.hue === "number" && Number.isFinite(from.hue) ? Math.round(turned(from.hue)) % 360 : undefined;
    return { kind, hue, dark: typeof from.dark === "number" ? held(from.dark) : 0 };
}
