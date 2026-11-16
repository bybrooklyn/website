// The site's picture service: Astro's own (sharp), but a large AVIF is written progressive where this
// machine can (scripts/avif.ts), so that in Chromium the picture shows whole and slightly soft once a
// tenth of it has arrived. Everything but the last step is sharp's: the picture is resized and turned
// upright as before and handed on as a PNG.
//
// Only a large picture is made so. One of a few kilobytes arrives all at once, so there is nothing to
// show early, and measured on the site's own covers and screenshots the progressive file was 15 to 40
// in a hundred larger for it; on photographs of a few hundred kilobytes it was about 4 larger. So the
// ordinary AVIF is made first, and kept unless it is large and the progressive one is not much larger.
// Where the tool is missing the AVIF is sharp's, as it was.

import type { LocalImageService } from "astro";
import sharpService from "astro/assets/services/sharp";
import { progressiveAvif, ROOM, WORTH } from "../../scripts/avif";

/** The quality an AVIF is written at when none is asked for, as sharp writes it. */
const USUAL = 50;
const NAMED: Record<string, number> = { low: 25, mid: 50, high: 80, max: 100 };
const service: LocalImageService = {
    ...sharpService,
    async transform(input, options, config, ...rest) {
        const plain = await sharpService.transform(input, options, config, ...rest);
        if (options.format !== "avif" || plain.data.length < WORTH) return plain;
        const asked = options.quality;
        const quality = typeof asked === "number" ? asked : typeof asked === "string" ? (NAMED[asked] ?? (Number(asked) || USUAL)) : USUAL;
        const png = await sharpService.transform(input, { ...options, format: "png", quality: undefined }, config, ...rest);
        const made = png.format === "png" ? await progressiveAvif(png.data, quality) : undefined;
        return made && made.length <= plain.data.length * ROOM ? { data: made, format: "avif" } : plain;
    },
};

export default service;
