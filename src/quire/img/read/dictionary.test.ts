// The dictionary is read out of the recognizer's YAML exactly: quoted and plain characters, the quote
// itself, a backslash, and the blank and the space the model adds; and the three real files, where
// they are on this machine, give as many characters as their recognizers have outputs.

import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { readDictionary, scalar } from "./dictionary";
import { tierOf } from "./models";

test("plain, single-quoted and double-quoted characters are read as the characters they are", () => {
    expect(scalar("a")).toBe("a");
    expect(scalar("'!'")).toBe("!");
    expect(scalar("''''")).toBe("'");
    expect(scalar("'\"'")).toBe('"');
    expect(scalar("\\")).toBe("\\");
    expect(scalar('"\\u3000"')).toBe("\u3000");
    expect(scalar('"\\""')).toBe('"');
    expect(scalar("$")).toBe("$");
    expect(scalar("鸟")).toBe("鸟");
});

test("the list under character_dict is read to its end, with the blank first and the space last", () => {
    const yml = ["PostProcess:", "  name: CTCLabelDecode", "  character_dict:", "  - '!'", "  - ''''", "  - \\", "  - A", "  - 鸟", "Other:", "  - not this"].join("\n");
    expect(readDictionary(yml)).toEqual(["", "!", "'", "\\", "A", "鸟", " "]);
    expect(() => readDictionary("PostProcess:\n  name: CTC\n")).toThrow("no list of characters");
});

test("the real dictionaries give one character for each of their recognizer's outputs", async () => {
    const outputs: Record<string, number> = { tiny: 6906, small: 18710, large: 18710 };
    let read = 0;
    for (const id of ["tiny", "small", "large"]) {
        const each = tierOf(id).files.find((file) => file.role === "dictionary")!;
        const kept = Bun.file(`${homedir()}/.cache/quire-model-trials/ocr/${each.repo.slice("PaddlePaddle/".length)}/${each.path}`);
        if (!(await kept.exists())) continue;
        const characters = readDictionary(await kept.text());
        expect(characters.length).toBe(outputs[id]!);
        expect(characters.slice(1, 4)).toEqual(["!", '"', "#"]);
        expect(characters).toContain("a");
        expect(characters).toContain("@");
        read++;
    }
    if (!read) console.warn("real dictionaries not read: the text models are not on this machine");
});
