// The download on a made-up folder and a made-up server: whole files, a download cut short that
// resumes from the bytes kept, a server that ignores the range, files already whole left alone, and
// a file of the wrong size refused.

import { describe, expect, test } from "bun:test";
import { download, nameOf, type Folder } from "./download";
import type { Tier } from "./models";

const tier: Tier = {
    id: "tiny",
    name: "Test",
    note: "",
    engine: "moonshine",
    repo: "owner/repo",
    license: "MIT",
    credit: "",
    files: [
        { role: "encoder", path: "a/one.bin", bytes: 10 },
        { role: "decoder", path: "two.bin", bytes: 6 },
    ],
};

/** A folder in memory. */
function folder(): Folder & { data: Map<string, Uint8Array>; marks: Set<string> } {
    const data = new Map<string, Uint8Array>();
    const marks = new Set<string>();
    return {
        data,
        marks,
        async open(name) {
            if (!data.has(name)) data.set(name, new Uint8Array(0));
            return {
                size: () => data.get(name)!.length,
                write(bytes, at) {
                    const old = data.get(name)!;
                    const next = new Uint8Array(Math.max(old.length, at + bytes.length));
                    next.set(old);
                    next.set(bytes, at);
                    data.set(name, next);
                },
                truncate: (size) => data.set(name, data.get(name)!.slice(0, size)),
                flush() {},
                close() {},
            };
        },
        whole: async (name) => marks.has(name),
        mark: async (name) => void marks.add(name),
    };
}

const content = (path: string) => Uint8Array.from({ length: path.endsWith("one.bin") ? 10 : 6 }, (_, i) => i + 1);

/** A server for the files, in chunks of 3 bytes, that can honour ranges and can fail after some bytes. */
function server(options: { ranges?: boolean; failAfter?: number; wrong?: boolean } = {}) {
    const { ranges = true } = options;
    let sent = 0;
    const asked: (string | null)[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).replace("https://huggingface.co/owner/repo/resolve/main/", "");
        const range = new Headers(init?.headers).get("range");
        asked.push(range);
        const whole = options.wrong ? content(path).slice(0, 4) : content(path);
        const from = ranges && range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
        const body = whole.slice(from);
        let at = 0;
        return new Response(
            new ReadableStream({
                pull(controller) {
                    if (options.failAfter !== undefined && sent >= options.failAfter) return controller.error(new Error("connection lost"));
                    if (at >= body.length) return controller.close();
                    const chunk = body.slice(at, at + 3);
                    at += chunk.length;
                    sent += chunk.length;
                    controller.enqueue(chunk);
                },
            }),
            { status: ranges && range ? 206 : 200 },
        );
    }) as typeof fetch;
    return { fetcher, asked };
}

describe("download", () => {
    test("writes every file whole, marks it, and reports bytes up to the total", async () => {
        const kept = folder();
        const seen: number[] = [];
        await download(tier, kept, { fetch: server().fetcher, progress: (bytes) => seen.push(bytes) });
        expect([...kept.data.get(nameOf("a/one.bin"))!]).toEqual([...content("one.bin")]);
        expect(kept.marks.size).toBe(2);
        expect(seen.at(-1)).toBe(16);
        expect(seen).toEqual([...seen].sort((a, b) => a - b));
    });
    test("carries on from the bytes kept after a failure, asking only for the rest", async () => {
        const kept = folder();
        await expect(download(tier, kept, { fetch: server({ failAfter: 6 }).fetcher, progress: () => {} })).rejects.toThrow("connection lost");
        expect(kept.marks.size).toBe(0);
        expect(kept.data.get(nameOf("a/one.bin"))!.length).toBe(6);
        const again = server();
        await download(tier, kept, { fetch: again.fetcher, progress: () => {} });
        expect(again.asked[0]).toBe("bytes=6-");
        expect([...kept.data.get(nameOf("a/one.bin"))!]).toEqual([...content("one.bin")]);
        expect(kept.marks.size).toBe(2);
    });
    test("starts the file again when the server ignores the range", async () => {
        const kept = folder();
        await expect(download(tier, kept, { fetch: server({ ranges: false, failAfter: 6 }).fetcher, progress: () => {} })).rejects.toThrow();
        await download(tier, kept, { fetch: server({ ranges: false }).fetcher, progress: () => {} });
        expect([...kept.data.get(nameOf("a/one.bin"))!]).toEqual([...content("one.bin")]);
    });
    test("leaves files that are already whole alone", async () => {
        const kept = folder();
        await download(tier, kept, { fetch: server().fetcher, progress: () => {} });
        const again = server();
        await download(tier, kept, { fetch: again.fetcher, progress: () => {} });
        expect(again.asked).toEqual([]);
    });
    test("refuses a file that arrives at the wrong size and does not mark it", async () => {
        const kept = folder();
        await expect(download(tier, kept, { fetch: server({ wrong: true }).fetcher, progress: () => {} })).rejects.toThrow("arrived as 4 bytes");
        expect(kept.marks.size).toBe(0);
    });
    test("stops when cancelled, keeping what arrived", async () => {
        const kept = folder();
        const stop = new AbortController();
        const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
            init?.signal?.throwIfAborted();
            return new Response(
                new ReadableStream({
                    pull(controller) {
                        stop.abort();
                        controller.enqueue(Uint8Array.of(1, 2, 3));
                        init?.signal?.throwIfAborted();
                    },
                }),
            );
        }) as typeof fetch;
        await expect(download(tier, kept, { fetch: slow, signal: stop.signal, progress: () => {} })).rejects.toBeDefined();
        expect(kept.marks.size).toBe(0);
    });
});
