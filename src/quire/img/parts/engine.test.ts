// What the part models' engine is held to, away from a browser: it says a choice is not kept until
// every file of it is, fetches each file from its pinned address with no referrer and no cookies and
// keeps it only when its size and digest are the table's, refuses one that is not with a plain reason,
// and with nothing kept says so rather than trying to run. The real models are run in real.test.ts.

import { expect, test } from "bun:test";
import { serve, type Answer } from "./engine";
import { PART_TIERS } from "./models";
import { keptName } from "../read/models";
import type { Shelf } from "../read/store";

const memory = (): Shelf & { files: Map<string, Uint8Array | string> } => {
    const files = new Map<string, Uint8Array | string>();
    return {
        files,
        write: async (name, bytes) => void files.set(name, bytes),
        read: async (name) => files.get(name) as Uint8Array | undefined,
        size: async (name) => (files.get(name) as Uint8Array | undefined)?.length ?? -1,
        mark: async (name, said) => void files.set(`${name}.whole`, said),
        marked: async (name) => files.get(`${name}.whole`) as string | undefined,
    };
};

test("a choice is not kept until every file is; a file of the wrong size or digest is refused; nothing is fetched but the pinned addresses", async () => {
    const shelf = memory();
    const said: Answer[] = [];
    const tools = { shelf: async () => shelf, say: (answer: Answer) => void said.push(answer) };
    await serve({ type: "have", id: 1, tier: "small" }, tools);
    expect(said.at(-1)).toEqual({ type: "have", id: 1, have: false });
    const asked: { url: string; init?: RequestInit }[] = [];
    // a server that answers with bytes of the right length but the wrong digest
    const wrong = (async (url: string, init?: RequestInit) => {
        asked.push({ url, init });
        const each = PART_TIERS[0]!.files.find((file) => url.endsWith(file.path))!;
        return new Response(new Uint8Array(each.bytes));
    }) as unknown as typeof fetch;
    await serve({ type: "fetch", id: 2, tier: "small" }, { ...tools, fetch: wrong });
    const failed = said.at(-1) as Extract<Answer, { type: "failed" }>;
    expect(failed.type).toBe("failed");
    expect(failed.message).toContain("digest does not match");
    expect(asked[0]!.url).toBe(`https://huggingface.co/Xenova/slimsam-77-uniform/resolve/5850ab45f587c112167512ffef949107115e26a0/onnx/vision_encoder_quantized.onnx`);
    expect(asked[0]!.init).toMatchObject({ referrerPolicy: "no-referrer", credentials: "omit" });
    expect(shelf.files.has(keptName(PART_TIERS[0]!.files[0]!))).toBe(false);
    // with nothing kept, a press says the files are not kept rather than running
    await serve({ type: "select", id: 3, tier: "small", key: "k", presses: [{ x: 1, y: 1, add: true }], prefer: "wasm" }, tools);
    expect((said.at(-1) as Extract<Answer, { type: "failed" }>).message).toContain("not kept whole");
});
