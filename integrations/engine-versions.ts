// Gives each WebAssembly engine in public/wasm/ an address that changes when the file does.
//
// The engines keep their names when they are rebuilt (scripts/wasm.ts), while the scripts that
// drive them are hashed by the build and change at once on a deploy. Cached under a fixed name, an
// old engine could be run by new script that expects other functions. So at build time every
// "/wasm/<name>.wasm" written in the site's own code becomes "/wasm/<name>.wasm?v=<hash of the
// file>", and a rebuilt engine is a new address no cache has seen. The code keeps the plain
// address (src/minis/walking.ts and roaming.ts), which is also what the tests see.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The first twelve hex digits of the SHA-256 of each .wasm file in a folder, by file name. */
export function versionsOf(folder: string): Map<string, string> {
    const versions = new Map<string, string>();
    for (const name of readdirSync(folder)) {
        if (name.endsWith(".wasm")) versions.set(name, createHash("sha256").update(readFileSync(join(folder, name))).digest("hex").slice(0, 12));
    }
    return versions;
}

/** Puts the version on every quoted "/wasm/<name>.wasm" in a piece of code whose file is known. */
export function versioned(code: string, versions: Map<string, string>): string {
    return code.replace(/(["'`])\/wasm\/([\w-]+\.wasm)\1/g, (whole, quote: string, name: string) => {
        const version = versions.get(name);
        return version ? `${quote}/wasm/${name}?v=${version}${quote}` : whole;
    });
}

/** A Vite plugin doing the above to the site's own source files, for pages and workers alike. */
export function engineVersions(folder: string) {
    const versions = versionsOf(folder);
    return {
        name: "engine-versions",
        transform(code: string, id: string) {
            if (id.includes("/node_modules/") || !code.includes("/wasm/")) return null;
            const changed = versioned(code, versions);
            return changed === code ? null : { code: changed, map: null };
        },
    };
}
