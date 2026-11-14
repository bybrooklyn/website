// Running one of imgQuire's encoders (or its HEIC reader), built to WebAssembly by codecs/build.sh
// and kept in public/quire/codecs/. A module is fetched only when its format is first picked, its
// bytes checked against the SHA-256 pinned in codecs.json before it is compiled, and it runs off the
// page's thread, in a worker of its own made from this same file. Each run gets a fresh instance, so
// that its memory goes with it.
//
//   page:   const blob = await encodeWith("avif", pixels, 80, 8);      a worker per module, kept
//   worker: this file, answering one message per job
//
// The modules answer the same few calls (codecs/wrap/qabi.h): q_alloc, q_opt, encode or decode,
// q_out_ptr and q_info. They need nothing from the page but a few calls that only an error message
// or a growing memory would make, which are given as no-ops.

import pins from "./codecs.json";

/** A module's pin: its name, the SHA-256 of its bytes, its size, its size with brotli, and what it was built from. */
export interface Pin {
    name: string;
    sha256: string;
    bytes: number;
    brotli: number;
    source: string;
}

/** Every module, by name. */
export const PINS: Record<string, Pin> = Object.fromEntries((pins as Pin[]).map((pin) => [pin.name, pin]));

/** Where the modules are served from. */
export const HOME = "/quire/codecs/";

/** One job for a module: encode pixels, or decode a file. */
export type Job = { name: string; pixels: ArrayBuffer; width: number; height: number; quality: number; speed: number; options: Record<number, number> } | { name: string; file: ArrayBuffer };

/** The hex SHA-256 of some bytes. */
export async function sha256(bytes: ArrayBuffer): Promise<string> {
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compiles a module's bytes, refusing them unless they are the pinned ones. */
export async function compile(bytes: ArrayBuffer, pin: Pin): Promise<WebAssembly.Module> {
    const found = await sha256(bytes);
    if (found !== pin.sha256) throw new Error(`the ${pin.name} encoder that arrived is not the one this page was built with`);
    return WebAssembly.compile(bytes);
}

/** A fresh instance of a module, every import it asks for answered: nothing but empty calls, and leaving stopping it. */
export async function instance(module: WebAssembly.Module): Promise<WebAssembly.Instance> {
    const imports: Record<string, Record<string, () => number>> = {};
    for (const each of WebAssembly.Module.imports(module)) {
        imports[each.module] ??= {};
        imports[each.module]![each.name] =
            each.name === "proc_exit"
                ? () => {
                      throw new Error("the encoder stopped");
                  }
                : () => 0;
    }
    const made = await WebAssembly.instantiate(module, imports);
    // a module built by Emscripten sets up its C library (its stack, its constructors) before it is used
    (made.exports._initialize as (() => void) | undefined)?.();
    return made;
}

type Calls = {
    memory: WebAssembly.Memory;
    q_alloc(size: number): number;
    q_opt(key: number, value: number): void;
    q_out_ptr(): number;
    q_info(at: number): number;
    encode?(at: number, size: number, width: number, height: number, quality: number, speed: number): number;
    decode?(at: number, size: number): number;
};

/** Runs one job on an instance: the file's bytes for an encode, the pixels and their size for a decode. */
export function run(found: WebAssembly.Instance, job: Job): { bytes: Uint8Array; width?: number; height?: number } {
    const calls = found.exports as unknown as Calls;
    const input = new Uint8Array("file" in job ? job.file : job.pixels);
    const at = calls.q_alloc(input.length);
    if (!at) throw new Error("the encoder had no room for the picture");
    new Uint8Array(calls.memory.buffer, at, input.length).set(input);
    let size: number;
    if ("file" in job) size = calls.decode!(at, input.length);
    else {
        for (const [key, value] of Object.entries(job.options)) calls.q_opt?.(Number(key), value);
        size = calls.encode!(at, input.length, job.width, job.height, job.quality, job.speed);
    }
    if (size < 0) throw new Error(`the ${job.name} ${"file" in job ? "reader" : "encoder"} failed (${size}, ${calls.q_info(0)})`);
    const bytes = new Uint8Array(calls.memory.buffer, calls.q_out_ptr(), size).slice();
    return "file" in job ? { bytes, width: calls.q_info(0), height: calls.q_info(1) } : { bytes };
}

// ---- the worker: one compiled module kept per name, each job a fresh instance ----

const compiled = new Map<string, Promise<WebAssembly.Module>>();
const inWorker = typeof self !== "undefined" && typeof (self as { importScripts?: unknown }).importScripts === "function";
if (inWorker)
    self.onmessage = async (event: MessageEvent<Job & { id: number }>) => {
        const job = event.data;
        try {
            const pin = PINS[job.name];
            if (!pin) throw new Error(`there is no ${job.name} encoder`);
            if (!compiled.has(job.name)) compiled.set(job.name, fetch(`${HOME}${pin.name}.wasm`).then((answer) => answer.arrayBuffer()).then((bytes) => compile(bytes, pin)));
            const done = run(await instance(await compiled.get(job.name)!), job);
            (self as unknown as Worker).postMessage({ id: job.id, ...done }, [done.bytes.buffer]);
        } catch (error) {
            compiled.delete(job.name);
            (self as unknown as Worker).postMessage({ id: job.id, error: error instanceof Error ? error.message : String(error) });
        }
    };

// ---- the page's side: a worker per module, made when its format is first picked ----

const workers = new Map<string, Worker>();
let jobs = 0;

/** Sends a job to its module's worker and waits for what it gives back. */
function ask(job: Job): Promise<{ bytes: Uint8Array; width?: number; height?: number }> {
    let worker = workers.get(job.name);
    if (!worker) {
        worker = new Worker(new URL("./codec-run.ts", import.meta.url), { type: "module" });
        workers.set(job.name, worker);
    }
    const id = ++jobs;
    const busy = worker;
    return new Promise((done, failed) => {
        const answer = (event: MessageEvent<{ id: number; error?: string; bytes: Uint8Array; width?: number; height?: number }>) => {
            if (event.data.id !== id) return;
            busy.removeEventListener("message", answer);
            if (event.data.error) failed(new Error(event.data.error));
            else done(event.data);
        };
        busy.addEventListener("message", answer);
        busy.postMessage({ ...job, id });
    });
}

/** Encodes pixels with a module: quality from 0 to 100, its speed, and its options (0 = lossless). */
export async function encodeWith(name: string, pixels: ImageData, quality: number, speed: number, options: Record<number, number> = {}, type = "application/octet-stream"): Promise<Blob> {
    const copy = pixels.data.slice().buffer;
    const { bytes } = await ask({ name, pixels: copy, width: pixels.width, height: pixels.height, quality, speed, options });
    return new Blob([bytes as BlobPart], { type });
}

/** True when a file's first bytes say it is a HEIC or HEIF photograph, as a phone writes them: its box of kinds names one, whatever the file is called. */
export function heicIn(bytes: Uint8Array): boolean {
    const kind = new TextDecoder().decode(bytes.subarray(4, 12));
    return kind.startsWith("ftyp") && ["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"].includes(kind.slice(4));
}

/** Reads a HEIC photograph into pixels, with the HEIC module. */
export async function decodeHeic(file: Blob): Promise<ImageData> {
    const { bytes, width, height } = await ask({ name: "heic", file: await file.arrayBuffer() });
    return new ImageData(new Uint8ClampedArray(bytes), width!, height!);
}
