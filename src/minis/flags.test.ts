// The flags pride sand is poured in, held to: the site's own two in the site's own colors, the
// stripes of every flag fitting the engine's colors, and the row of colors laid out as `place` says.

import { expect, test } from "bun:test";
import { colorRow, FLAGS, MOST_STRIPES, place, rgb } from "./flags";

test("the two flags by the site's name are offered in the colors the site draws them in", async () => {
    const css = await Bun.file(new URL("../styles/base.css", import.meta.url)).text();
    for (const name of ["trans", "lesbian"]) {
        const drawn = new RegExp(`\\.flag\\.${name} \\{\\s*background: linear-gradient\\(([^;]+)\\);`).exec(css)![1]!;
        const colors = [...drawn.matchAll(/#[0-9a-f]{3,6}\b/gi)].map(([hex]) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex).toLowerCase());
        expect(FLAGS.find((flag) => flag.name === name)!.stripes).toEqual(colors);
    }
    expect(FLAGS[0]!.name).toBe("rainbow");
});

test("every flag's stripes fit among the engine's colors, each where place says, in order", () => {
    const row = colorRow();
    const total = FLAGS.reduce((sum, flag) => sum + flag.stripes.length, 0);
    expect(total).toBeLessThanOrEqual(MOST_STRIPES);
    FLAGS.forEach((flag, index) => {
        const { first, count } = place(index);
        expect(count).toBe(flag.stripes.length);
        flag.stripes.forEach((stripe, k) => expect([...row.slice((first + k) * 4, (first + k) * 4 + 4)]).toEqual([...rgb(stripe), 255]));
    });
    expect(rgb("#5bcefa")).toEqual([91, 206, 250]);
});
