// Values a mini reads from outside itself, made safe before use: what the browser kept from an
// earlier visit (`m.recall`), which may be an old format, damaged or edited by hand, and what the
// page's address says (`m.link`), which anyone can write. Each gives a sane value of the kind
// asked for, or the one it is told to fall back on.

/** A whole number from low to high: a fraction is rounded down and a number outside is brought inside. Anything that is not a finite number gives `otherwise`. */
export function whole(value: unknown, low: number, high: number, otherwise: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return otherwise;
    return Math.min(high, Math.max(low, Math.floor(value)));
}

/** A number from low to high, brought inside if it is outside. Anything that is not a finite number gives `otherwise`. */
export function within(value: unknown, low: number, high: number, otherwise: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) return otherwise;
    return Math.min(high, Math.max(low, value));
}

/** A whole number written in the address, such as `?field=3`: only digits count, so "Infinity", "1e9", "-2" and "0x10" give `otherwise`. */
export function wholeText(text: string | null, low: number, high: number, otherwise: number): number {
    if (text === null || !/^\s*\d{1,15}\s*$/.test(text)) return otherwise;
    return whole(Number(text), low, high, otherwise);
}

/** A string of at most `most` characters, or `otherwise`. */
export function text(value: unknown, most: number, otherwise: string): string {
    return typeof value === "string" && value.length <= most ? value : otherwise;
}

/** One of `choices`, or `otherwise`. */
export function oneOf<T>(value: unknown, choices: readonly T[], otherwise: T): T {
    return choices.includes(value as T) ? (value as T) : otherwise;
}

/** A plain object, not an array and not null, to read fields from; or undefined. */
export function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** An array of at most `most` things, each made safe by `each`, which leaves out the ones it gives undefined for. Anything that is not an array gives an empty one. */
export function list<T>(value: unknown, most: number, each: (item: unknown) => T | undefined): T[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, most).map(each).filter((item): item is T => item !== undefined);
}
