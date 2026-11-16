// Names and sizes for the converter: the name a converted file leaves with (its own name, the new
// ending, and a number in brackets when the name is taken, so that nothing is ever overwritten), and a
// size in bytes, a length of time and a count of pixels said in plain units.
//
//   outName("photo.jpg", ".webp", taken)   "photo.webp", then "photo (1).webp", "photo (2).webp"

/** A file's name without its ending: "photo" for "photo.jpg", the whole name when it has none. */
export function stemOf(name: string): string {
    const plain = name.split(/[\\/]/).pop() ?? name;
    const dot = plain.lastIndexOf(".");
    return dot > 0 ? plain.slice(0, dot) : plain;
}

/** A name a disk can hold: the characters no file system takes made a hyphen, and none left empty. */
export function plainName(name: string): string {
    const plain = name
        .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
        .trim()
        .replace(/^\.+/, "");
    return plain || "file";
}

/**
 * The name a converted file leaves with: its own stem and the new ending, or the stem with " (1)", " (2)"
 * and so on when that name is in `taken` already. The name given is added to `taken`, so that a batch
 * asked for in order gets `photo.webp` and `photo (1).webp`. Names are compared without case, as a
 * folder on Windows or a Mac compares them.
 */
export function outName(name: string, ending: string, taken: Set<string>): string {
    const stem = plainName(stemOf(name));
    for (let count = 0; ; count++) {
        const tried = count === 0 ? `${stem}${ending}` : `${stem} (${count})${ending}`;
        if (!taken.has(tried.toLowerCase())) {
            taken.add(tried.toLowerCase());
            return tried;
        }
    }
}

/** A size in bytes as a person reads it, in units of a thousand: "940 bytes", "412 KB", "3.4 MB", "1.2 GB". */
export function sizeSaid(bytes: number): string {
    if (bytes < 1000) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
    const units: [number, string][] = [
        [1e9, "GB"],
        [1e6, "MB"],
        [1e3, "KB"],
    ];
    for (const [size, unit] of units) {
        if (bytes < size) continue;
        const value = bytes / size;
        // three figures at most: 3.4 MB, 34 MB, 340 MB
        return `${value < 10 ? (Math.round(value * 10) / 10).toFixed(1) : Math.round(value)} ${unit}`;
    }
    return `${bytes} bytes`;
}

/** A length of time in seconds as a clock reads it: "0:07", "3:25", "1:02:09". */
export function timeSaid(seconds: number): string {
    const whole = Math.max(0, Math.round(seconds));
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = String(whole % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** A weight typed in a field ("200", "200 KB", "1.5 MB") as bytes, as imgQuire's export reads it: a bare number is kilobytes. Undefined when it is not one, or under a kilobyte. */
export function readWeight(text: string): number | undefined {
    const found = /^\s*(\d+(?:\.\d+)?)\s*(b|bytes?|kb|k|mb|m)?\s*$/i.exec(text);
    if (!found) return undefined;
    const unit = (found[2] ?? "kb").toLowerCase();
    const bytes = Number(found[1]) * (unit.startsWith("b") ? 1 : unit.startsWith("m") ? 1_000_000 : 1000);
    return bytes >= 1000 ? Math.round(bytes) : undefined;
}

/** How much smaller or larger the result is than the original, in words: "62% smaller", "8% larger", "the same size". */
export function changeSaid(before: number, after: number): string {
    if (!before) return "";
    const change = Math.round((1 - after / before) * 100);
    if (change === 0) return "the same size";
    return change > 0 ? `${change}% smaller` : `${-change}% larger`;
}
