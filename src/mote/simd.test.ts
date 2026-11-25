// The check for WebAssembly SIMD: Bun's engine runs SIMD, so the check says so, and it says no rather
// than throwing where WebAssembly cannot validate at all.
import { afterEach, expect, test } from "bun:test";
import { hasSimd } from "./simd";

const validate = WebAssembly.validate;
afterEach(() => {
    WebAssembly.validate = validate;
});

test("a runtime with SIMD is found to have it", () => {
    expect(hasSimd()).toBe(true);
});

test("a runtime that cannot validate is found to have no SIMD, without throwing", () => {
    WebAssembly.validate = () => {
        throw new Error("no WebAssembly here");
    };
    expect(hasSimd()).toBe(false);
});
