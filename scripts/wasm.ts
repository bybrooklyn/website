// Builds the walking mini's engine, the Rust crate in walker/, into public/wasm/walker.wasm, and says
// how big it is. Run by hand with `bun run wasm` after changing the Rust; the built files are
// committed, so the site builds without Rust.
//
// It is built twice: with WebAssembly SIMD, which every current browser has, and without, as
// public/wasm/walker-scalar.wasm for a browser too old for SIMD (Safari before 16.4). The page picks
// one when it loads (`engineAddress` in src/minis/walking.ts). The two give the same numbers to the
// bit; src/minis/walker.test.ts holds them to it.
//
// It fails if either module is over 512 KiB, or if the physics built alone (without the walker
// feature) is over 80 KiB.

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { at } from "./lib";

const KIB = 1024;
const crate = at("walker");
const built = (target: string) => `${crate}/${target}/wasm32-unknown-unknown/release/walker.wasm`;
/** What the browser build may use besides plain WebAssembly: copying memory in one instruction, and SIMD. */
const SIMD = "-C target-feature=+bulk-memory,+simd128";
const SCALAR = "-C target-feature=+bulk-memory,-simd128";

/** Builds the crate for the browser and returns the size of the result in bytes. */
async function build(name: string, flags: string[], rust: string, target: string, limit: number): Promise<number> {
    await $`cargo build --release --target wasm32-unknown-unknown --target-dir ${target} ${flags}`.cwd(crate).env({ ...process.env, RUSTFLAGS: rust });
    const size = Bun.file(built(target)).size;
    console.log(`${name}: ${size} bytes (${(size / KIB).toFixed(1)} KiB, the limit is ${limit / KIB} KiB)`);
    if (size > limit) {
        console.error(`${name} is over its limit.`);
        process.exit(1);
    }
    return size;
}

// each build has a target folder of its own, so the builds do not undo each other
await build("the physics alone", ["--no-default-features"], SIMD, "target/physics", 80 * KIB);
// the Walker alone: the crate's default has the generalist too, for `cargo test`
const WALKER = ["--no-default-features", "--features", "walker"];
await build("walker.wasm", WALKER, SIMD, "target", 512 * KIB);
await build("walker-scalar.wasm", WALKER, SCALAR, "target/scalar", 512 * KIB);

await mkdir(at("public/wasm"), { recursive: true });
await Bun.write(at("public/wasm/walker.wasm"), Bun.file(built("target")));
await Bun.write(at("public/wasm/walker-scalar.wasm"), Bun.file(built("target/scalar")));
console.log("copied to public/wasm/walker.wasm and public/wasm/walker-scalar.wasm");
