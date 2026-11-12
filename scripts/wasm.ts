// Builds the walking mini's engine, the Rust crate in walker/, into public/wasm/walker.wasm, and says
// how big it is. Run by hand with `bun run wasm` after changing the Rust; the built file is committed,
// so the site builds without Rust.
//
// It fails if the module is over 512 KiB, or if the physics built alone (without the walker feature)
// is over 50 KiB: the limits the mini was planned with.

import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { at } from "./lib";

const KIB = 1024;
const crate = at("walker");
const built = (target: string) => `${crate}/${target}/wasm32-unknown-unknown/release/walker.wasm`;

/** Builds the crate for the browser and returns the size of the result in bytes. */
async function build(name: string, flags: string[], target: string, limit: number): Promise<number> {
    await $`cargo build --release --target wasm32-unknown-unknown --target-dir ${target} ${flags}`.cwd(crate);
    const size = Bun.file(built(target)).size;
    console.log(`${name}: ${size} bytes (${(size / KIB).toFixed(1)} KiB, the limit is ${limit / KIB} KiB)`);
    if (size > limit) {
        console.error(`${name} is over its limit.`);
        process.exit(1);
    }
    return size;
}

// the physics alone builds into a target folder of its own, so the two builds do not undo each other
await build("the physics alone", ["--no-default-features"], "target/physics", 50 * KIB);
await build("walker.wasm", [], "target", 512 * KIB);

await mkdir(at("public/wasm"), { recursive: true });
await Bun.write(at("public/wasm/walker.wasm"), Bun.file(built("target")));
console.log("copied to public/wasm/walker.wasm");
