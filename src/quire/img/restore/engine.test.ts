// What the restoring models' engine is held to, away from a browser: a model is not kept until its file is,
// and is fetched from its pinned address with no referrer and no cookies, kept only when its size and digest
// are the table's; with nothing kept a run says so rather than trying; a tile goes to the model reflected past
// its edges to the size the model takes, in 32 or 16 bits, and comes back as pixels with its own alpha; a model
// runs on the graphics card only where it was found to run right there, and on WebAssembly only where it runs
// in good time. The real models are run in real.test.ts.

import { expect, test } from "bun:test";
import { keptName } from "../read/models";
import type { Shelf } from "../read/store";
import { fromHalf } from "./half";
import { pixelsOf, placeFor, planesOf, serve, type Answer } from "./engine";
import { ENLARGE_MODELS, REPAIR_MODELS } from "./models";

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

test("a model is fetched only from its pinned address, kept only whole, and not run when not kept", async () => {
    const model = REPAIR_MODELS[0]!;
    const shelf = memory();
    const said: Answer[] = [];
    const tools = { shelf: async () => shelf, say: (answer: Answer) => void said.push(answer) };
    await serve({ type: "have", id: 1, model: model.id }, tools);
    expect(said.at(-1)).toEqual({ type: "have", id: 1, have: false });
    const asked: { url: string; init?: RequestInit }[] = [];
    const wrong = (async (url: string, init?: RequestInit) => {
        asked.push({ url, init });
        return new Response(new Uint8Array(model.bytes));
    }) as unknown as typeof fetch;
    await serve({ type: "fetch", id: 2, model: model.id }, { ...tools, fetch: wrong });
    expect((said.at(-1) as Extract<Answer, { type: "failed" }>).message).toContain("digest does not match");
    expect(asked[0]!.url).toBe(`https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.path}`);
    expect(asked[0]!.init).toMatchObject({ referrerPolicy: "no-referrer", credentials: "omit" });
    expect(shelf.files.has(keptName(model))).toBe(false);
    // a bitmap stand-in: a run with nothing kept says so and closes the picture it was handed
    let closed = false;
    const picture = { width: 4, height: 4, close: () => (closed = true) } as unknown as ImageBitmap;
    await serve({ type: "run", id: 3, model: model.id, picture, prefer: "webgpu" }, tools);
    expect((said.at(-1) as Extract<Answer, { type: "failed" }>).message).toContain("not kept whole");
    expect(closed).toBe(true);
    await serve({ type: "have", id: 4, model: "no-such-model" }, tools);
    expect((said.at(-1) as Extract<Answer, { type: "failed" }>).message).toContain("no model called");
});

test("a model runs on the card only where it was found to run right there, and else on WebAssembly where it runs in good time", () => {
    expect(placeFor(ENLARGE_MODELS[0]!, true)).toBe("wasm");
    expect(placeFor(REPAIR_MODELS[1]!, true)).toBe("webgpu");
    expect(placeFor(REPAIR_MODELS[1]!, false)).toBeUndefined();
    const card = { ...REPAIR_MODELS[0]!, places: ["webgpu" as const] };
    const processor = { ...REPAIR_MODELS[0]!, places: ["wasm" as const] };
    expect(placeFor(card, true)).toBe("webgpu");
    expect(placeFor(card, false)).toBeUndefined();
    // a model that gives wrong answers on the card runs on WebAssembly even where there is a card
    expect(placeFor(processor, true)).toBe("wasm");
    expect(placeFor(processor, false)).toBe("wasm");
    expect(placeFor(card, true, "wasm")).toBeUndefined();
});

test("a tile is reflected past its edges to the model's size, and its answer cut back with its own alpha", () => {
    // a 3 by 2 tile of numbered pixels, alpha 7 on the first
    const data = new Uint8ClampedArray(3 * 2 * 4);
    for (let k = 0; k < 6; k++) data.set([k * 40, k * 40 + 1, k * 40 + 2, k === 0 ? 7 : 255], k * 4);
    const tile = { width: 3, height: 2, data };
    const wide = planesOf(tile, { input: "float32", multiple: 4 });
    expect([wide.width, wide.height]).toEqual([4, 4]);
    // the red plane: rows a b c | b, the rows below the second reflected back (row 1, row 0)
    const red = Array.from(wide.planes.subarray(0, 16), (value) => Math.round(value * 255));
    expect(red).toEqual([0, 40, 80, 40, 120, 160, 200, 160, 0, 40, 80, 40, 120, 160, 200, 160]);
    const fixed = planesOf(tile, { input: "float16", fixed: 5 });
    expect([fixed.width, fixed.height]).toEqual([5, 5]);
    expect(fixed.planes).toBeInstanceOf(Uint16Array);
    expect(Math.round(fromHalf(fixed.planes[1]!) * 255)).toBe(40);
    // an answer twice as large, of a padded 4 by 4 input: the tile's part kept, alpha enlarged by nearest pixels
    const values = new Float32Array(3 * 8 * 8).fill(0.5);
    const back = pixelsOf(values, 8, 8, tile, 2);
    expect([back.width, back.height]).toEqual([6, 4]);
    expect(back.data[0]).toBe(128);
    expect(back.data[3]).toBe(7);
    expect(back.data[(1 * 6 + 1) * 4 + 3]).toBe(7);
    expect(back.data[(0 * 6 + 2) * 4 + 3]).toBe(255);
    expect(() => pixelsOf(new Float32Array(3 * 8 * 8).fill(Number.NaN), 8, 8, tile, 2)).toThrow("no numbers");
    // a 16-bit answer given as its bits is read as halves (0x3800 is a half)
    expect(pixelsOf(new Uint16Array(3 * 8 * 8).fill(0x3800), 8, 8, tile, 2).data[0]).toBe(128);
});
