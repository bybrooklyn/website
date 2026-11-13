// Tests that an engine's address carries a version made from the file, and that nothing else is touched.

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { engineVersions, versioned, versionsOf } from "./engine-versions";

const folder = fileURLToPath(new URL("../public/wasm/", import.meta.url));

describe("engine versions", () => {
    test("every engine in public/wasm has a version of twelve hex digits", () => {
        const versions = versionsOf(folder);
        expect([...versions.keys()].sort()).toEqual(["generalist-scalar.wasm", "generalist.wasm", "walker-scalar.wasm", "walker.wasm"]);
        for (const version of versions.values()) expect(version).toMatch(/^[0-9a-f]{12}$/);
    });

    test("two different files get different versions", () => {
        const versions = versionsOf(folder);
        expect(new Set(versions.values()).size).toBe(versions.size);
    });

    test("a quoted engine address gets its version, in any kind of quote", () => {
        const versions = new Map([["walker.wasm", "abc123abc123"]]);
        expect(versioned(`const ENGINE = "/wasm/walker.wasm";`, versions)).toBe(`const ENGINE = "/wasm/walker.wasm?v=abc123abc123";`);
        expect(versioned("fetch(`/wasm/walker.wasm`)", versions)).toBe("fetch(`/wasm/walker.wasm?v=abc123abc123`)");
        expect(versioned(`a='/wasm/walker.wasm'`, versions)).toBe(`a='/wasm/walker.wasm?v=abc123abc123'`);
    });

    test("an unknown engine, a comment and other text are left alone", () => {
        const versions = new Map([["walker.wasm", "abc123abc123"]]);
        const code = `// public/wasm/walker.wasm\nconst other = "/wasm/missing.wasm"; const near = "/wasm/walker.wasm.map";`;
        expect(versioned(code, versions)).toBe(code);
    });

    test("the plugin changes the site's code and not a library's", () => {
        const plugin = engineVersions(folder);
        const code = `export const ENGINE = "/wasm/walker.wasm";`;
        expect(plugin.transform(code, "/site/src/minis/walking.ts")?.code).toMatch(/\/wasm\/walker\.wasm\?v=[0-9a-f]{12}"/);
        expect(plugin.transform(code, "/site/node_modules/thing/index.js")).toBeNull();
    });
});
