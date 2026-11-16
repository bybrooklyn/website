// A batch going out: many files written one after another into one zip as they are made, or straight into
// a folder chosen on this computer, never over a file already there; and the work behind them run a few
// pictures at a time, so that a hundred photographs never sit in memory together. Used by imgQuire's Export
// all and by the cut-out page's Save all.
//
//   const out = zipOut(blobSink());                  or folderOut(await showDirectoryPicker(...))
//   const names = namesFor(given, ".webp", await out.taken());
//   await runEach(given.length, (at) => make(at), (at, blob) => out.write(names[at], blob), { signal, progress });
//   const zip = await out.finish();                  a Blob for blobSink, nothing for a file or a folder

import type { FileHandle, FolderHandle } from "../core/store-folder";
import { crc32 } from "../core/zip";
import { freeFileName } from "./batch";

/** Where a batch's files go: each written under a free name (the name it went under given back), and the whole finished or abandoned. */
export interface Destination {
    /** The names already in the place, which the batch's names must not take: a folder's files, nothing for a new zip. */
    taken(): Promise<string[]>;
    write(name: string, blob: Blob): Promise<string>;
    /** Done: a zip's directory written and its file closed; a zip held in this tab is given back as a Blob. */
    finish(): Promise<Blob | undefined>;
    abort(): Promise<void>;
}

/** Where a zip's bytes go as they are written: a file chosen on this computer, written as it goes, or a Blob made of the parts. */
export interface Sink {
    write(part: Uint8Array | Blob): Promise<void>;
    close(): Promise<Blob | undefined>;
    abort(): Promise<void>;
}

/** A zip held in this tab as a Blob of its parts: each part is the encoded file itself, never copied into one buffer, so the browser may keep it on its disk. */
export function blobSink(): Sink {
    let parts: BlobPart[] = [];
    return {
        write: async (part) => void parts.push(part as BlobPart),
        close: async () => new Blob(parts, { type: "application/zip" }),
        abort: async () => void (parts = []),
    };
}

/** A zip written into a file chosen with the browser's save picker, part by part as the files are made. */
export async function fileSink(handle: Pick<FileHandle, "createWritable">): Promise<Sink> {
    const writable = await handle.createWritable();
    return {
        write: (part) => writable.write(part as Blob),
        close: async () => (await writable.close(), undefined),
        abort: async () => void (await (writable.abort?.() ?? writable.close()).catch(() => undefined)),
    };
}

/** A date and time as zip files keep them, in the old two-second DOS form. */
function dosTime(date: Date): { time: number; day: number } {
    const year = Math.max(1980, date.getFullYear());
    return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}

/** The most a zip without zip64 can hold, in bytes and in files. */
export const ZIP_MOST = { bytes: 0xfffffffe, files: 0xffff };

/**
 * A zip written as it goes: each file's header (its checksum and size known, since the file is made whole
 * before it is written) and then the file, stored as it is, the pictures being squeezed already; the
 * directory at the end on `finish`. One file's bytes are read at a time, for its checksum.
 */
export function zipOut(sink: Sink, date = new Date()): Destination {
    const encoder = new TextEncoder();
    const { time, day } = dosTime(date);
    const centrals: Uint8Array[] = [];
    const used = new Set<string>();
    let offset = 0;
    // one write at a time, in the order they were asked for
    let line: Promise<unknown> = Promise.resolve();
    return {
        taken: async () => [],
        write(wanted, blob) {
            const job = line.then(async () => {
                const name = freeFileName(wanted, (each) => used.has(each.toLowerCase()));
                used.add(name.toLowerCase());
                const bytes = new Uint8Array(await blob.arrayBuffer());
                const coded = encoder.encode(name);
                if (bytes.length + offset + 30 + coded.length > ZIP_MOST.bytes || centrals.length >= ZIP_MOST.files) throw new Error("the zip would be over 4 GB; save into a folder instead");
                const crc = crc32(bytes);
                const local = new Uint8Array(30 + coded.length);
                const view = new DataView(local.buffer);
                view.setUint32(0, 0x04034b50, true);
                view.setUint16(4, 20, true);
                view.setUint16(6, 0x0800, true); // the name is UTF-8
                view.setUint16(8, 0, true); // stored as it is
                view.setUint16(10, time, true);
                view.setUint16(12, day, true);
                view.setUint32(14, crc, true);
                view.setUint32(18, bytes.length, true);
                view.setUint32(22, bytes.length, true);
                view.setUint16(26, coded.length, true);
                local.set(coded, 30);
                await sink.write(local);
                await sink.write(blob);
                const central = new Uint8Array(46 + coded.length);
                const entry = new DataView(central.buffer);
                entry.setUint32(0, 0x02014b50, true);
                entry.setUint16(4, (3 << 8) | 20, true);
                entry.setUint16(6, 20, true);
                entry.setUint16(8, 0x0800, true);
                entry.setUint16(12, time, true);
                entry.setUint16(14, day, true);
                entry.setUint32(16, crc, true);
                entry.setUint32(20, bytes.length, true);
                entry.setUint32(24, bytes.length, true);
                entry.setUint16(28, coded.length, true);
                entry.setUint32(38, (0o100644 << 16) >>> 0, true); // an ordinary file anyone may read
                entry.setUint32(42, offset, true);
                central.set(coded, 46);
                centrals.push(central);
                offset += local.length + bytes.length;
                return name;
            });
            line = job.catch(() => undefined);
            return job;
        },
        async finish() {
            await line;
            const size = centrals.reduce((sum, part) => sum + part.length, 0);
            const end = new Uint8Array(22);
            const tail = new DataView(end.buffer);
            tail.setUint32(0, 0x06054b50, true);
            tail.setUint16(8, centrals.length, true);
            tail.setUint16(10, centrals.length, true);
            tail.setUint32(12, size, true);
            tail.setUint32(16, offset, true);
            for (const part of centrals) await sink.write(part);
            await sink.write(end);
            return sink.close();
        },
        abort: () => sink.abort(),
    };
}

/** Files written straight into a folder chosen on this computer, each under a name no file there has: a name found taken just before writing is moved on to the next free one, so nothing is ever written over. */
export function folderOut(folder: Pick<FolderHandle, "values" | "getFileHandle">): Destination {
    const used = new Set<string>();
    let listed = false;
    const list = async () => {
        if (listed) return;
        listed = true;
        for await (const each of folder.values()) used.add(each.name.toLowerCase());
    };
    const there = async (name: string) =>
        folder.getFileHandle(name).then(
            () => true,
            () => false,
        );
    let line: Promise<unknown> = Promise.resolve();
    return {
        async taken() {
            await list();
            return [...used];
        },
        write(wanted, blob) {
            const job = line.then(async () => {
                await list();
                let name = freeFileName(wanted, (each) => used.has(each.toLowerCase()));
                // something else may have put a file there since the folder was listed
                while (await there(name)) {
                    used.add(name.toLowerCase());
                    name = freeFileName(wanted, (each) => used.has(each.toLowerCase()));
                }
                used.add(name.toLowerCase());
                const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
                await writable.write(blob);
                await writable.close();
                return name;
            });
            line = job.catch(() => undefined);
            return job;
        },
        finish: async () => (await line, undefined),
        abort: async () => void (await line),
    };
}

/** What a run over a batch came to: how many were done, whether it was stopped, and those that failed with why. */
export interface Ran {
    done: number;
    stopped: boolean;
    failed: { at: number; error: unknown }[];
}

/**
 * Makes each of `count` things with `work`, at most `atOnce` at a time, and hands each to `keep` in their
 * order, one at a time, so a zip lists its files as the batch does; one made before its turn waits for it,
 * which also keeps no more than `atOnce` made and unkept. `progress` hears how many are done after each.
 * Stopped by the signal, nothing new is started and what was being made is let go unkept. One that fails is
 * said in `failed` and the rest go on.
 */
export async function runEach<T>(count: number, work: (at: number, signal: AbortSignal) => Promise<T>, keep: (at: number, made: T) => Promise<void>, options: { atOnce?: number; signal?: AbortSignal; progress?(done: number, count: number): void } = {}): Promise<Ran> {
    const signal = options.signal ?? new AbortController().signal;
    const failed: Ran["failed"] = [];
    let next = 0;
    let done = 0;
    // whose turn it is to be kept, and those waiting for theirs
    let turn = 0;
    const waiting = new Map<number, () => void>();
    const myTurn = (at: number) => (at === turn || signal.aborted ? Promise.resolve() : new Promise<void>((go) => waiting.set(at, go)));
    const passTurn = () => {
        turn++;
        waiting.get(turn)?.();
        waiting.delete(turn);
    };
    const stopped = () => {
        for (const go of waiting.values()) go();
        waiting.clear();
    };
    signal.addEventListener("abort", stopped);
    const lane = async () => {
        while (next < count && !signal.aborted) {
            const at = next++;
            let made: T | undefined;
            let error: unknown;
            let ok = false;
            try {
                made = await work(at, signal);
                ok = true;
            } catch (problem) {
                error = problem;
            }
            await myTurn(at);
            if (signal.aborted) return;
            try {
                if (!ok) throw error;
                await keep(at, made as T);
                done++;
            } catch (problem) {
                failed.push({ at, error: problem });
            }
            passTurn();
            options.progress?.(done + failed.length, count);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(options.atOnce ?? 3, count)) }, lane));
    signal.removeEventListener("abort", stopped);
    return { done, stopped: signal.aborted && done + failed.length < count, failed };
}

/** How many pictures to make at once: a few, fewer on a machine of few cores, so that the memory of each in flight stays bounded. */
export const atOnce = () => Math.max(1, Math.min(3, Math.floor((globalThis.navigator?.hardwareConcurrency ?? 4) / 2)));
