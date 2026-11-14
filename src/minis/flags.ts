// The flags the sand mini pours pride sand in. Each is its stripes from the top, a stripe that is
// wider than the others written as many times as it is wide, so that a flag poured or laid as a
// block has its stripes in the right proportions. The trans and lesbian flags are the two by the
// site's name, in the colors the site draws them in (`.flag.trans` and `.flag.lesbian` in
// src/styles/base.css, the same as mdQuire's flag colors in src/quire/md/bar.ts); the others are
// in their usual colors.
//
// The engine's cells carry a stripe's number, not its color: `colorRow` lays every flag's stripes
// out as the third row of the drawing's palette, and `place` says where a flag's begin.

/** A flag: its name, and its stripes' colors from the top, as six hexadecimal digits each. */
export interface Flag {
    name: string;
    stripes: string[];
}

/** The flags offered, in the order they are shown. */
export const FLAGS: Flag[] = [
    { name: "rainbow", stripes: ["#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"] },
    { name: "trans", stripes: ["#5bcefa", "#f5a9b8", "#ffffff", "#f5a9b8", "#5bcefa"] },
    { name: "lesbian", stripes: ["#d52d00", "#ff9a56", "#ffffff", "#d362a4", "#a30262"] },
    { name: "bisexual", stripes: ["#d60270", "#d60270", "#9b4f96", "#0038a8", "#0038a8"] },
    { name: "pansexual", stripes: ["#ff218c", "#ffd800", "#21b1ff"] },
    { name: "nonbinary", stripes: ["#fcf434", "#ffffff", "#9c59d1", "#2c2c2c"] },
];

/** The most stripe colors the engine keeps apart (`STRIPES` in sand/src/materials.rs). */
export const MOST_STRIPES = 64;

/** Where a flag's stripes begin in the row of stripe colors, and how many it has. */
export function place(index: number): { first: number; count: number } {
    const first = FLAGS.slice(0, index).reduce((sum, flag) => sum + flag.stripes.length, 0);
    return { first, count: FLAGS[index]?.stripes.length ?? 1 };
}

/** A color written as six hexadecimal digits, as red, green and blue from 0 to 255. */
export function rgb(hex: string): [number, number, number] {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** The third row of the palette: every flag's stripes one after another, 256 colors of four bytes. */
export function colorRow(): Uint8Array {
    const row = new Uint8Array(1024);
    let at = 0;
    for (const flag of FLAGS) {
        for (const stripe of flag.stripes) {
            row.set([...rgb(stripe), 255], at * 4);
            at++;
        }
    }
    return row;
}
