// The arithmetic of a flat thing seen at an angle, for the reader: the map (a homography, nine numbers)
// that takes four places on the code, counted in modules, to where they are seen in the picture, found by
// solving the eight equations the four pairs give. imgQuire has its own (`img/homography.ts`); the tools
// of the suite do not reach into one another, so this one is written again here, smaller.
//
//   const map = mapFour([{ x: 3.5, y: 3.5 }, ...], [{ x: 120, y: 80 }, ...]);
//   const seen = through(map, 10.5, 4.5);

/** A place, in modules or in pixels. */
export interface Point {
    x: number;
    y: number;
}

/** A homography: nine numbers, row by row, the last 1. */
export type Map9 = number[];

/** Solves a square system of linear equations by elimination with the largest pivot; undefined when it has no single answer. */
export function solve(rows: number[][], values: number[]): number[] | undefined {
    const n = values.length;
    const a = rows.map((row, i) => [...row, values[i]!]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let row = col + 1; row < n; row++) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
        if (Math.abs(a[pivot]![col]!) < 1e-12) return undefined;
        [a[col], a[pivot]] = [a[pivot]!, a[col]!];
        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const factor = a[row]![col]! / a[col]![col]!;
            if (factor === 0) continue;
            for (let k = col; k <= n; k++) a[row]![k]! -= factor * a[col]![k]!;
        }
    }
    return a.map((row, i) => row[n]! / row[i]!);
}

/** The homography that takes four places to four others; undefined when three of them lie on a line. */
export function mapFour(from: Point[], to: Point[]): Map9 | undefined {
    const rows: number[][] = [];
    const values: number[] = [];
    for (let i = 0; i < 4; i++) {
        const { x, y } = from[i]!;
        const { x: u, y: v } = to[i]!;
        rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
        values.push(u);
        rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
        values.push(v);
    }
    const found = solve(rows, values);
    return found ? [...found, 1] : undefined;
}

/** Where a homography takes a place. */
export function through(map: Map9, x: number, y: number): Point {
    const w = map[6]! * x + map[7]! * y + map[8]!;
    return { x: (map[0]! * x + map[1]! * y + map[2]!) / w, y: (map[3]! * x + map[4]! * y + map[5]!) / w };
}
