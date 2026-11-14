// Builds the walking mini's engine, the Rust crate in walker/, into public/wasm/walker.wasm, the
// generalist's, from the same crate, into public/wasm/generalist.wasm, and the sand mini's, the crate
// in sand/, into public/wasm/sand.wasm, and says how big each is. Run by hand with `bun run wasm` after changing the Rust; the built files are
// committed, so the site builds without Rust.
//
// Each is built twice: with WebAssembly SIMD, which every current browser has, and without, as
// public/wasm/walker-scalar.wasm for a browser too old for SIMD (Safari before 16.4). The page picks
// one when it loads (`engineAddress` in src/minis/walking.ts). The two give the same numbers to the
// bit; src/minis/walker.test.ts holds them to it.
//
// It fails if any module is over 512 KiB, if the physics built alone (without either
// feature) is over 80 KiB, or if the sand engine is over 128 KiB.

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
async function build(name: string, flags: string[], rust: string, target: string, limit: number, from = crate, file = built(target)): Promise<number> {
    await $`cargo build --release --target wasm32-unknown-unknown --target-dir ${target} ${flags}`.cwd(from).env({ ...process.env, RUSTFLAGS: rust });
    const size = Bun.file(file).size;
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
// the generalist alone, a second mini on the same engine
const GENERALIST = ["--no-default-features", "--features", "generalist"];
await build("generalist.wasm", GENERALIST, SIMD, "target/generalist", 512 * KIB);
await build("generalist-scalar.wasm", GENERALIST, SCALAR, "target/generalist-scalar", 512 * KIB);

// the sand mini's engine, a crate of its own, the same two ways
const sand = at("sand");
const sandBuilt = (target: string) => `${sand}/${target}/wasm32-unknown-unknown/release/sand.wasm`;
await build("sand.wasm", [], SIMD, "target", 128 * KIB, sand, sandBuilt("target"));
await build("sand-scalar.wasm", [], SCALAR, "target/scalar", 128 * KIB, sand, sandBuilt("target/scalar"));

await mkdir(at("public/wasm"), { recursive: true });
await Bun.write(at("public/wasm/walker.wasm"), Bun.file(built("target")));
await Bun.write(at("public/wasm/walker-scalar.wasm"), Bun.file(built("target/scalar")));
await Bun.write(at("public/wasm/generalist.wasm"), Bun.file(built("target/generalist")));
await Bun.write(at("public/wasm/generalist-scalar.wasm"), Bun.file(built("target/generalist-scalar")));
await Bun.write(at("public/wasm/sand.wasm"), Bun.file(sandBuilt("target")));
await Bun.write(at("public/wasm/sand-scalar.wasm"), Bun.file(sandBuilt("target/scalar")));
console.log("copied to public/wasm/: walker.wasm, walker-scalar.wasm, generalist.wasm, generalist-scalar.wasm, sand.wasm, sand-scalar.wasm");
