// What a batch going out is held to: the zip written as it goes reads back, every file byte for byte under
// its name, a second of one name moved on to `photo (1)`; a folder is never written over, a name taken while
// the batch runs moved on too; and the work runs a few at a time, no more, keeps each thing it makes in turn,
// goes on past one that fails, and stops starting new work when asked.

import { expect, test } from "bun:test";
import { readZip } from "../core/zip";
import { blobSink, folderOut, runEach, zipOut } from "./batch-out";

const file = (text: string) => new Blob([new TextEncoder().encode(text)], { type: "image/webp" });

test("the zip written as it goes reads back, every file byte for byte, and a second of one name is moved on", async () => {
    const out = zipOut(blobSink(), new Date(2026, 10, 15, 14, 30));
    expect(await out.taken()).toEqual([]);
    const names = await Promise.all([out.write("a.webp", file("one")), out.write("b.webp", file("two")), out.write("a.webp", file("three")), out.write("A.webp", file("four"))]);
    expect(names).toEqual(["a.webp", "b.webp", "a (1).webp", "A (2).webp"]);
    const zip = (await out.finish())!;
    const read = await readZip(new Uint8Array(await zip.arrayBuffer()));
    expect([...read.keys()]).toEqual(names);
    expect(new TextDecoder().decode(read.get("a (1).webp"))).toBe("three");
    // a large picture is stored whole, its checksum right
    const big = new Uint8Array(3_000_000).map((_, at) => (at * 31) & 255);
    const second = zipOut(blobSink());
    await second.write("big.png", new Blob([big]));
    const back = await readZip(new Uint8Array(await (await second.finish())!.arrayBuffer()));
    expect(back.get("big.png")!.length).toBe(big.length);
    expect(back.get("big.png")![2_999_999]).toBe(big[2_999_999]!);
});

test("a folder is never written over: names already there and one put there while it runs are moved on", async () => {
    const files = new Map<string, Blob>([["photo.webp", file("old")], ["Photo (1).webp", file("old too")]]);
    const folder = {
        async *values() {
            for (const name of [...files.keys()]) yield { kind: "file" as const, name } as never;
        },
        async getFileHandle(name: string, options?: { create?: boolean }) {
            if (!files.has(name) && !options?.create) throw new DOMException("not there", "NotFoundError");
            return {
                kind: "file" as const,
                name,
                getFile: async () => files.get(name) as never,
                createWritable: async () => {
                    let kept: Blob | undefined;
                    return { write: async (data: string | Blob) => void (kept = data as Blob), close: async () => void files.set(name, kept!) };
                },
            };
        },
    };
    const out = folderOut(folder);
    expect((await out.taken()).sort()).toEqual(["photo (1).webp", "photo.webp"]);
    expect(await out.write("photo.webp", file("new"))).toBe("photo (2).webp");
    // a file put there by something else after the folder was listed
    files.set("other.webp", file("theirs"));
    expect(await out.write("other.webp", file("mine"))).toBe("other (1).webp");
    await out.finish();
    expect(await files.get("photo.webp")!.text()).toBe("old");
    expect(await files.get("other.webp")!.text()).toBe("theirs");
    expect(await files.get("photo (2).webp")!.text()).toBe("new");
});

test("the work runs a few at a time, each kept in turn; one that fails is said and the rest go on; stopping starts nothing new", async () => {
    let running = 0;
    let most = 0;
    const kept: number[] = [];
    const ran = await runEach(
        12,
        async (at) => {
            running++;
            most = Math.max(most, running);
            await Bun.sleep(5 + ((at * 7) % 11));
            running--;
            if (at === 4) throw new Error("no");
            return at;
        },
        async (at) => void kept.push(at),
        { atOnce: 3 },
    );
    expect(most).toBe(3);
    expect(ran.done).toBe(11);
    expect(ran.failed.map((each) => each.at)).toEqual([4]);
    expect(kept.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11]);

    const stop = new AbortController();
    const started: number[] = [];
    const stopped = await runEach(
        20,
        async (at) => {
            started.push(at);
            if (at === 3) stop.abort();
            await Bun.sleep(5);
            return at;
        },
        async () => {},
        { atOnce: 2, signal: stop.signal },
    );
    expect(stopped.stopped).toBe(true);
    expect(started.length).toBeLessThanOrEqual(5);
});
