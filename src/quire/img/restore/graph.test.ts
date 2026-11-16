// The mend to a model file is held to touching only its first output's size names: in a small model written
// here, the input's names stay, the output's lose their last letter to `_`, every length is kept, and a file
// cut short is refused with a reason rather than read past its end.

import { expect, test } from "bun:test";
import { untieOutput } from "./graph";

const field = (number: number, ...parts: Uint8Array[]) => {
    const body = new Uint8Array(parts.reduce((sum, each) => sum + each.length, 0));
    let at = 0;
    for (const each of parts) (body.set(each, at), (at += each.length));
    const length: number[] = [];
    for (let left = body.length; ; left >>= 7) {
        length.push((left & 0x7f) | (left > 0x7f ? 0x80 : 0));
        if (left <= 0x7f) break;
    }
    return new Uint8Array([(number << 3) | 2, ...length, ...body]);
};
const text = (number: number, said: string) => field(number, new TextEncoder().encode(said));
// a value's size names: type, tensor type, shape, one dimension for each name
const value = (name: string, names: string[]) => field(0, text(1, name), field(2, field(1, field(2, ...names.map((each) => field(1, text(2, each)))))));
// the same field under another number (values are made under 0 and renumbered: input 11, output 12, notes 13)
const named = (number: number, made: Uint8Array) => new Uint8Array([(number << 3) | 2, ...made.subarray(1)]);

test("only the first output's size names are renamed, at the same length", () => {
    const graph = field(7, new Uint8Array([0x10 | 0, 0]), named(11, value("pixel_values", ["batch", "height", "width"])), named(12, value("reconstruction", ["batch", "height", "width"])), named(13, value("graph_input_cast_0", ["height"])), named(13, value("graph_output_cast_0", ["height"])));
    const model = new Uint8Array([0x08, 6, ...graph]);
    const before = new TextDecoder().decode(model);
    const length = model.length;
    expect(untieOutput(model)).toBe(4);
    const after = new TextDecoder().decode(model);
    expect(model.length).toBe(length);
    expect(after.indexOf("pixel_values")).toBe(before.indexOf("pixel_values"));
    expect(after).toContain("height");
    expect(after).toContain("heigh_");
    expect(after).toContain("widt_");
    expect(after).toContain("batc_");
    expect(() => untieOutput(model.subarray(0, model.length - 3))).toThrow("longer than what holds it");
});
