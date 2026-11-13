// The download on a made-up folder and a made-up server: whole files, a download cut short that
// resumes from the bytes kept, a server that ignores the range, files already whole left alone, and
// a file of the wrong size refused.

import { describe, expect, test } from "bun:test";
import { download, nameOf, sha256, whole, type Folder } from "./download";
import type { Tier } from "./models";

const tier: Tier = {
    id: "tiny",
    name: "Test",
    note: "",
    who: "",
    engine: "moonshine",
    repo: "owner/repo",
    revision: "main",
    license: "MIT",
    credit: "",
    files: [
        { role: "encoder", path: "a/one.bin", bytes: 10 },
        { role: "decoder", path: "two.bin", bytes: 6 },
    ],
};

/** A folder in memory. */
function folder(options: { short?: boolean } = {}): Folder & { data: Map<string, Uint8Array>; marks: Map<string, string> } {
    const data = new Map<string, Uint8Array>();
    const marks = new Map<string, string>();
    return {
        data,
        marks,
        async open(name) {
            if (!data.has(name)) data.set(name, new Uint8Array(0));
            return {
                size: () => data.get(name)!.length,
                write(given, at) {
                    // a disk that is filling up keeps only part of what it is given
                    const bytes = options.short ? given.slice(0, 1) : given;
                    const old = data.get(name)!;
                    const next = new Uint8Array(Math.max(old.length, at + bytes.length));
                    next.set(old);
                    next.set(bytes, at);
                    data.set(name, next);
                    return bytes.length;
                },
                truncate: (size) => data.set(name, data.get(name)!.slice(0, size)),
                flush() {},
                close() {},
            };
        },
        marked: async (name) => marks.get(name),
        mark: async (name, signature) => void marks.set(name, signature),
        size: async (name) => data.get(name)?.length ?? -1,
        read: async (name) => data.get(name)!,
    };
}

const content = (path: string) => Uint8Array.from({ length: path.endsWith("one.bin") ? 10 : 6 }, (_, i) => i + 1);

/** A server for the files, in chunks of 3 bytes, that can honour ranges and can fail after some bytes. */
function server(options: { ranges?: boolean; failAfter?: number; wrong?: boolean; elsewhere?: boolean; longer?: boolean } = {}) {
    const { ranges = true } = options;
    let sent = 0;
    const asked: (string | null)[] = [];
    const addresses: string[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
        addresses.push(String(input));
        const path = String(input).replace(/^https:\/\/huggingface\.co\/owner\/repo\/resolve\/[^/]+\//, "");
        const range = new Headers(init?.headers).get("range");
        asked.push(range);
        const whole = options.wrong ? content(path).slice(0, 4) : options.longer ? Uint8Array.from({ length: content(path).length + 5 }, (_, i) => i + 1) : content(path);
        // a server that answers a range from another place than the one asked: from the start, but saying 206
        const from = ranges && range && !options.elsewhere ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
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
            ranges && range ? { status: 206, headers: { "content-range": `bytes ${from}-${whole.length - 1}/${whole.length}` } } : { status: 200 },
        );
    }) as typeof fetch;
    return { fetcher, asked, addresses };
}

/** How many files are marked whole, not merely arriving. */
const wholeOnes = (kept: ReturnType<typeof folder>) => [...kept.marks.values()].filter((mark) => !mark.startsWith("partial")).length;

describe("download", () => {
    test("writes every file whole, marks it, and reports bytes up to the total", async () => {
        const kept = folder();
        const seen: number[] = [];
        await download(tier, kept, { fetch: server().fetcher, progress: (bytes) => seen.push(bytes) });
        expect([...kept.data.get(nameOf("a/one.bin"))!]).toEqual([...content("one.bin")]);
        expect(wholeOnes(kept)).toBe(2);
        expect(seen.at(-1)).toBe(16);
        expect(seen).toEqual([...seen].sort((a, b) => a - b));
    });
    test("carries on from the bytes kept after a failure, asking only for the rest", async () => {
        const kept = folder();
        await expect(download(tier, kept, { fetch: server({ failAfter: 6 }).fetcher, progress: () => {} })).rejects.toThrow("connection lost");
        expect(wholeOnes(kept)).toBe(0);
        expect(kept.data.get(nameOf("a/one.bin"))!.length).toBe(6);
        const again = server();
        await download(tier, kept, { fetch: again.fetcher, progress: () => {} });
        expect(again.asked[0]).toBe("bytes=6-");
        expect([...kept.data.get(nameOf("a/one.bin"))!]).toEqual([...content("one.bin")]);
        expect(wholeOnes(kept)).toBe(2);
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
        expect(wholeOnes(kept)).toBe(0);
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
        await expect(download(tier, kept, { fetch: slow, signal: stop.signal, progress: () => {} })).rejects.toThrow();
        expect(stop.signal.aborted).toBe(true);
        expect(wholeOnes(kept)).toBe(0);
        expect(kept.data.get(nameOf("a/one.bin"))!.length).toBe(3);
    });
});

describe("what is trusted", () => {
    test("files are fetched at the tier's revision", async () => {
        const kept = folder();
        const pinned = server();
        await download({ ...tier, revision: "0123abcd" }, kept, { fetch: pinned.fetcher, progress: () => {} });
        expect(pinned.addresses[0]).toBe("https://huggingface.co/owner/repo/resolve/0123abcd/a/one.bin");
    });
    test("a file marked whole for an older table (another revision) is fetched again, not trusted", async () => {
        const kept = folder();
        await download(tier, kept, { fetch: server().fetcher, progress: () => {} });
        const again = server();
        await download({ ...tier, revision: "0123abcd" }, kept, { fetch: again.fetcher, progress: () => {} });
        expect(again.asked).toEqual([null, null]);
        expect(wholeOnes(kept)).toBe(2);
    });
    test("a file marked whole whose size is not the table's is fetched again", async () => {
        const kept = folder();
        await download(tier, kept, { fetch: server().fetcher, progress: () => {} });
        kept.data.set(nameOf("two.bin"), new Uint8Array(2));
        const again = server();
        await download(tier, kept, { fetch: again.fetcher, progress: () => {} });
        expect(again.asked).toEqual([null]);
        expect([...kept.data.get(nameOf("two.bin"))!]).toEqual([...content("two.bin")]);
    });
    test("a mark made before marks said anything stands for the branch main, and is trusted only while the table is on it", async () => {
        const kept = folder();
        await download(tier, kept, { fetch: server().fetcher, progress: () => {} });
        for (const name of kept.marks.keys()) kept.marks.set(name, "");
        expect(whole(tier, tier.files[0]!, "", 10)).toBe(true);
        expect(whole({ revision: "0123abcd" }, tier.files[0]!, "", 10)).toBe(false);
        const again = server();
        await download(tier, kept, { fetch: again.fetcher, progress: () => {} });
        expect(again.asked).toEqual([]);
    });
    test("bytes kept from another revision are not joined to the new one's", async () => {
        const kept = folder();
        await expect(download(tier, kept, { fetch: server({ failAfter: 6 }).fetcher, progress: () => {} })).rejects.toThrow();
        const again = server();
        await download({ ...tier, revision: "0123abcd" }, kept, { fetch: again.fetcher, progress: () => {} });
        expect(again.asked[0]).toBe(null);
        expect([...kept.data.get(nameOf("a/one.bin"))!]).toEqual([...content("one.bin")]);
    });
    test("a file whose digest is in the table is checked: the right bytes are marked, others refused and dropped", async () => {
        const digest = await sha256(content("one.bin"));
        const checked: Tier = { ...tier, files: [{ ...tier.files[0]!, sha256: digest }] };
        const kept = folder();
        await download(checked, kept, { fetch: server().fetcher, progress: () => {} });
        expect(wholeOnes(kept)).toBe(1);
        const wrong: Tier = { ...tier, files: [{ ...tier.files[0]!, sha256: "00".repeat(32) }] };
        const other = folder();
        await expect(download(wrong, other, { fetch: server().fetcher, progress: () => {} })).rejects.toThrow("digest");
        expect(wholeOnes(other)).toBe(0);
        expect(other.data.get(nameOf("a/one.bin"))!.length).toBe(0);
    });
    test("a resumed answer that starts from another place than the one asked is not joined: the file is fetched from the start", async () => {
        const kept = folder();
        await expect(download(tier, kept, { fetch: server({ failAfter: 6 }).fetcher, progress: () => {} })).rejects.toThrow();
        const again = server({ elsewhere: true });
        await download(tier, kept, { fetch: again.fetcher, progress: () => {} });
        expect(again.asked.slice(0, 2)).toEqual(["bytes=6-", null]);
        expect([...kept.data.get(nameOf("a/one.bin"))!]).toEqual([...content("one.bin")]);
    });
    test("a file that runs past its size is refused", async () => {
        const kept = folder();
        await expect(download(tier, kept, { fetch: server({ longer: true }).fetcher, progress: () => {} })).rejects.toThrow("longer");
        expect(wholeOnes(kept)).toBe(0);
    });
    test("a write that keeps fewer bytes than it was given is refused, not marked whole", async () => {
        const kept = folder({ short: true });
        await expect(download(tier, kept, { fetch: server().fetcher, progress: () => {} })).rejects.toThrow("could be kept");
        expect(wholeOnes(kept)).toBe(0);
    });
});
