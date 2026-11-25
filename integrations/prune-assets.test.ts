import { describe, expect, test } from "bun:test";
import { prunable, unused } from "./prune-assets";

describe("prune-assets", () => {
    test("pictures, scripts, trailers and engines may be pruned; pages and styles may not", () => {
        expect(prunable("_astro/cover.Ab12.avif")).toBe("cover.Ab12.avif");
        expect(prunable("_astro/page.Ab12.js")).toBe("page.Ab12.js");
        expect(prunable("videos/trailer.mp4")).toBe("/videos/trailer.mp4");
        expect(prunable("wasm/walker.wasm")).toBe("/wasm/walker.wasm");
        expect(prunable("_astro/site.Ab12.css")).toBeUndefined();
        expect(prunable("index.html")).toBeUndefined();
        expect(prunable("ort/ort.min.mjs")).toBeUndefined();
    });

    test("a script no other file names is unused, even if it names itself", () => {
        const texts = new Map([
            ["index.html", '<script src="/_astro/used.A.js"></script>'],
            ["_astro/used.A.js", 'import("./chunk.B.js")'],
            ["_astro/chunk.B.js", 'fetch("/wasm/sand.wasm?v=1")'],
            ["_astro/draft.C.js", 'new URL("draft.C.js", import.meta.url); fetch("/wasm/walker.wasm")'],
        ]);
        const files = [...texts.keys(), "wasm/sand.wasm", "wasm/walker.wasm"];
        // the draft's script goes first; the engine only it named goes on the next round
        expect(unused(texts, files)).toEqual(["_astro/draft.C.js"]);
        texts.delete("_astro/draft.C.js");
        expect(unused(texts, files.filter((file) => file !== "_astro/draft.C.js"))).toEqual(["wasm/walker.wasm"]);
    });
});
