// What the emoji table is held to: every name is one a shortcode can spell, every emoji is a single
// picture character, and a name not in the table, or one inherited from an object, gives nothing.

import { expect, test } from "bun:test";
import { EMOJI, emojiOf } from "./emoji";

test("every name can be typed as a shortcode, and every entry is an emoji", () => {
    expect(Object.keys(EMOJI).length).toBeGreaterThan(100);
    for (const [name, emoji] of Object.entries(EMOJI)) {
        expect({ name, spelled: /^[a-z0-9_+-]+$/.test(name) }).toEqual({ name, spelled: true });
        expect({ name, emoji: /\p{Extended_Pictographic}/u.test(emoji) }).toEqual({ name, emoji: true });
        expect([...new Intl.Segmenter().segment(emoji)].length).toBe(1);
    }
});

test("the common names are there, and nothing else is read as one", () => {
    expect(emojiOf("smile")).toBe("\u{1F604}");
    expect(emojiOf("+1")).toBe("\u{1F44D}");
    expect(emojiOf("tada")).toBe("\u{1F389}");
    expect(emojiOf("heart")).toBe("\u{2764}\u{FE0F}");
    for (const name of ["notanemoji", "toString", "constructor", "__proto__", "", "Smile"]) expect(emojiOf(name)).toBeUndefined();
});
