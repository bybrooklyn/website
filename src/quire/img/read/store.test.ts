// Keeping the models: each file fetched from its pinned address with no referrer and no cookies,
// kept only when its size and digest are the table's, fetched once and then used from storage, a file
// shared by two sizes fetched once, a file kept for another digest fetched again, and bytes changed in
// storage refused before a model is made of them.

import { expect, test } from "bun:test";
import { addressOf, keptName, type Tier } from "./models";
import { bytesOf, fetchTier, keptAll, keptBytes, sha256, type Shelf } from "./store";

/** A shelf in memory. */
function memoryShelf(): Shelf & { files: Map<string, Uint8Array>; marks: Map<string, string> } {
    const files = new Map<string, Uint8Array>();
    const marks = new Map<string, string>();
    return {
        files,
        marks,
        write: async (name, bytes) => void files.set(name, bytes.slice()),
        read: async (name) => files.get(name),
        size: async (name) => files.get(name)?.length ?? -1,
        mark: async (name, said) => void marks.set(name, said),
        marked: async (name) => marks.get(name),
    };
}

/** A made-up tier of two files, with the network that serves them. */
async function made() {
    const one = new TextEncoder().encode("the detector's bytes");
    const two = new TextEncoder().encode("the recognizer's bytes, a little longer");
    const tier: Tier = {
        id: "tiny",
        name: "Tiny",
        who: "",
        sure: 0.4,
        credit: "",
        files: [
            { role: "detect", repo: "PaddlePaddle/a", revision: "1".repeat(40), path: "inference.onnx", bytes: one.length, sha256: await sha256(one) },
            { role: "recognize", repo: "PaddlePaddle/b", revision: "2".repeat(40), path: "inference.onnx", bytes: two.length, sha256: await sha256(two) },
        ],
    };
    const served = new Map([[addressOf(tier.files[0]!), one], [addressOf(tier.files[1]!), two]]);
    const asked: { url: string; init: RequestInit }[] = [];
    const network = (async (url: string, init: RequestInit) => {
        asked.push({ url, init });
        const bytes = served.get(url);
        return bytes ? new Response(bytes) : new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    return { tier, one, two, served, asked, network };
}

test("each file is fetched from its pinned address with no referrer and no cookies, kept, and then used from storage", async () => {
    const { tier, asked, network, one } = await made();
    const shelf = memoryShelf();
    const progress: number[] = [];
    expect(await keptAll(shelf, tier)).toBe(false);
    await fetchTier(tier, shelf, { fetch: network, progress: (bytes) => progress.push(bytes) });
    expect(asked.map((each) => each.url)).toEqual(tier.files.map((each) => addressOf(each)));
    for (const each of asked) {
        expect(each.init.referrerPolicy).toBe("no-referrer");
        expect(each.init.credentials).toBe("omit");
        expect(each.init.body).toBeUndefined();
    }
    expect(progress.at(-1)).toBe(tier.files[0]!.bytes + tier.files[1]!.bytes);
    expect(await keptAll(shelf, tier)).toBe(true);
    expect(await bytesOf(shelf, tier.files[0]!)).toEqual(one);
    await fetchTier(tier, shelf, { fetch: network });
    expect(asked).toHaveLength(2);
    expect(await keptBytes(shelf, tier)).toBe(tier.files[0]!.bytes + tier.files[1]!.bytes);
});

test("a file whose digest is not the table's is refused and not kept", async () => {
    const { tier, served, network } = await made();
    served.set(addressOf(tier.files[1]!), new TextEncoder().encode("the recognizer's bytes, a little LONGER"));
    const shelf = memoryShelf();
    await expect(fetchTier(tier, shelf, { fetch: network })).rejects.toThrow("its digest does not match");
    expect(shelf.files.has(keptName(tier.files[1]!))).toBe(false);
    expect(await keptAll(shelf, tier)).toBe(false);
});

test("a file cut short or too long is refused", async () => {
    const { tier, served, network } = await made();
    served.set(addressOf(tier.files[0]!), new TextEncoder().encode("short"));
    await expect(fetchTier(tier, memoryShelf(), { fetch: network })).rejects.toThrow("arrived as 5 bytes");
    served.set(addressOf(tier.files[0]!), new TextEncoder().encode("the detector's bytes and more"));
    await expect(fetchTier(tier, memoryShelf(), { fetch: network })).rejects.toThrow("is longer than");
});

test("a file marked for another digest is fetched again, and bytes changed in storage are refused before use", async () => {
    const { tier, asked, network } = await made();
    const shelf = memoryShelf();
    await fetchTier(tier, shelf, { fetch: network });
    shelf.marks.set(keptName(tier.files[0]!), "0".repeat(64));
    await fetchTier(tier, shelf, { fetch: network });
    expect(asked).toHaveLength(3);
    const changed = shelf.files.get(keptName(tier.files[1]!))!;
    changed[0]! ^= 1;
    await expect(bytesOf(shelf, tier.files[1]!)).rejects.toThrow("not kept whole");
});
