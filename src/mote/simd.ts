// Whether this browser runs WebAssembly SIMD, for the minis that choose between a SIMD engine and a
// scalar one. Kept apart from any one mini, so that a mini asking it does not bring another's engine along.

/**
 * The smallest module that uses SIMD (it splats a byte and counts its bits), which a browser without
 * SIMD will not accept. The same test the wasm-feature-detect project uses.
 */
const SIMD_TEST = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

/** Whether this browser runs WebAssembly SIMD: every current one does; Safari before 16.4 does not. */
export const hasSimd = (): boolean => {
    try {
        return WebAssembly.validate(SIMD_TEST);
    } catch {
        return false;
    }
};
