// What asking how to repair or enlarge is held to: a machine with a graphics card is offered the repair models,
// one without none of them (both run in good time only on the card), and both are offered the enlarging model
// (it runs right only on WebAssembly); SCUNet is not offered for a JPEG made above quality 50, where it was
// measured to do worse than the instant repair; a way chosen before is remembered for each job on its own. The
// dialog itself, asked first and fetching nothing until told, is held in the editor's browser test (tool.test.ts).

import { afterEach, expect, test } from "bun:test";
import { modelsHere, rememberedWay } from "./asking";

const kept = new Map<string, string>();
globalThis.localStorage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) } as unknown as Storage;
afterEach(() => kept.clear());

test("the models offered follow the machine and the file's quality, and the way chosen is remembered for each job", () => {
    expect(modelsHere("repair", true, 30).map((each) => each.name)).toEqual(["Better", "Best"]);
    expect(modelsHere("repair", true, 75).map((each) => each.name)).toEqual(["Best"]);
    expect(modelsHere("repair", false, 30)).toEqual([]);
    expect(modelsHere("enlarge", true).map((each) => each.name)).toEqual(["Sharp"]);
    expect(modelsHere("enlarge", false).map((each) => each.name)).toEqual(["Sharp"]);
    expect(rememberedWay("repair")).toBeUndefined();
    kept.set("quire-img-repair", "repair-best");
    kept.set("quire-img-enlarge", "");
    expect(rememberedWay("repair")).toBe("repair-best");
    expect(rememberedWay("enlarge")).toBe("");
});
