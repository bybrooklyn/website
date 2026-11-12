// Bun.build plugins for the pages that bundle the editor with `Bun.build`. Dictation names its
// microphone worklet the way Vite does (`file.ts?worker&url`) and has a stylesheet, neither of
// which Bun's bundler knows.
//
//   withoutSpeech   for the editor's own browser tests: the styles and URLs are empty and the
//                   engine says it cannot store a model, so dictation reports that it is not
//                   available in such a page and the control is not drawn
//   forEditor       for `bun run edit`: the worklet is a file the editor serves at
//                   /capture-worklet.js, the engine worker is /engine-worker.ts (built beside the
//                   page, see write.ts), the styles are sent with the editor's, and the engine is
//                   the real one, so dictation works there as it does on the site
//
// The real build (`bun run build`) uses neither.

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

/** Lets the real dictation engine be bundled into the editor served by `bun run edit`. */
export const forEditor: BunPlugin = {
    name: "dictation-for-editor",
    setup(build) {
        build.onResolve({ filter: /\?(worker&)?url$/ }, () => ({ path: "worklet", namespace: "dictation-editor" }));
        build.onResolve({ filter: /dictation\.css$/ }, () => ({ path: "empty", namespace: "dictation-editor" }));
        build.onLoad({ filter: /.*/, namespace: "dictation-editor" }, (found) => ({
            contents: found.path === "worklet" ? 'export default "/capture-worklet.js";' : "",
            loader: "js",
        }));
    },
};
