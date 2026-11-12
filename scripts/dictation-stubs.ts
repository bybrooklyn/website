// A Bun.build plugin for the pages that bundle the editor with `Bun.build` (the editor's own
// browser tests and `bun run edit`). Dictation needs Vite's way of naming a worker or a worklet
// file (`file.ts?worker&url`), its stylesheet, and a worker that loads ONNX Runtime, none of which
// Bun's bundler knows. Here they are stubbed: the styles and URLs are empty, and the engine says it
// cannot store a model, so dictation reports that it is not available in such a page and the
// control is not drawn. The real build (`bun run build`) uses none of this.

import type { BunPlugin } from "bun";

/** Stubs what dictation needs from the real site build. */
export const withoutSpeech: BunPlugin = {
    name: "dictation-stubs",
    setup(build) {
        build.onResolve({ filter: /\?(worker&)?url$/ }, () => ({ path: "empty", namespace: "dictation-stub" }));
        build.onResolve({ filter: /dictation\.css$/ }, () => ({ path: "empty", namespace: "dictation-stub" }));
        build.onResolve({ filter: /^\.\/engine$/ }, (found) => (found.importer.includes("/dictation/") ? { path: "engine", namespace: "dictation-stub" } : undefined));
        build.onLoad({ filter: /.*/, namespace: "dictation-stub" }, (found) => ({
            contents: found.path === "engine" ? 'export const canStore = () => false; export const createProvider = () => { throw new Error("no speech engine in this page"); };' : 'export default "";',
            loader: "js",
        }));
    },
};
