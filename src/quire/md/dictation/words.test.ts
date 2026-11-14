// The custom words matcher: whole words only, any case, a few wrong letters forgiven in a
// sounds-like form, phrases, shortcuts, punctuation kept, and the stored list read safely.

import { describe, expect, test } from "bun:test";
import { allowed, correct, distance, load, nothing, save, type Custom } from "./words";

const list = (words: [string, string[]?][], shortcuts: [string, string][] = []): Custom => ({ words: words.map(([word, sounds]) => ({ word, sounds: sounds ?? [] })), shortcuts: shortcuts.map(([say, write]) => ({ say, write })) });

describe("distance", () => {
    test("counts single letter changes", () => {
        expect(distance("kitten", "sitting")).toBe(3);
        expect(distance("same", "same")).toBe(0);
        expect(distance("", "abc")).toBe(3);
    });
    test("allowed grows with the length", () => {
        expect([allowed(3), allowed(4), allowed(7), allowed(8)]).toEqual([0, 1, 1, 2]);
    });
});

describe("preferred words", () => {
    test("set the case of a word the recognizer wrote in another", () => {
        expect(correct("we use kubernetes here", list([["Kubernetes"]]))).toBe("we use Kubernetes here");
    });
    test("are whole words only", () => {
        expect(correct("the recitals went on", list([["Cit"]]))).toBe("the recitals went on");
    });
    test("forgive one wrong letter in a long word", () => {
        expect(correct("I met Brooklin yesterday", list([["Brooklyn"]]))).toBe("I met Brooklyn yesterday");
    });
    test("do not change a short word that is only close", () => {
        expect(correct("the cat sat", list([["Cot"]]))).toBe("the cat sat");
    });
});

describe("sounds-like forms", () => {
    test("are replaced by the preferred spelling", () => {
        expect(correct("ask Sioban about it", list([["Siobhan", ["shivon", "sivawn"]]]))).toBe("ask Siobhan about it");
        expect(correct("ask shivon about it", list([["Siobhan", ["shivon"]]]))).toBe("ask Siobhan about it");
    });
    test("forgive a wrong letter or two by their length", () => {
        expect(correct("ask shivan about it", list([["Siobhan", ["shivon"]]]))).toBe("ask Siobhan about it");
        expect(correct("a Kubernetis cluster", list([["Kubernetes", ["koo ber net ease"]]]))).toBe("a Kubernetes cluster");
    });
    test("can be several words, and replace all of them", () => {
        expect(correct("send it to bye brooklyn today", list([["bybrooklyn", ["bye brooklyn"]]]))).toBe("send it to bybrooklyn today");
    });
    test("are matched whatever the case", () => {
        expect(correct("Ask SHIVON", list([["Siobhan", ["shivon"]]]))).toBe("Ask Siobhan");
    });
    test("keep the punctuation around the word", () => {
        expect(correct('He said, "shivon," and left. Shivon!', list([["Siobhan", ["shivon"]]]))).toBe('He said, "Siobhan," and left. Siobhan!');
    });
    test("a short sounds-like form must match exactly", () => {
        expect(correct("a zed and a zid", list([["Z", ["zed"]]]))).toBe("a Z and a zid");
    });
    test("the longest match wins", () => {
        expect(correct("new york city", list([["NYC", ["new york city"]], ["York", ["york"]]]))).toBe("NYC");
    });
});

describe("shortcuts", () => {
    test("write their text for the spoken phrase", () => {
        expect(correct("please write to my email thanks", list([], [["my email", "me@example.com"]]))).toBe("please write to me@example.com thanks");
    });
    test("match whatever the case and punctuation the model gave", () => {
        expect(correct("Send it to My Email.", list([], [["my email", "me@example.com"]]))).toBe("Send it to me@example.com.");
    });
    test("must match the words exactly", () => {
        expect(correct("my emails are many", list([], [["my email", "me@example.com"]]))).toBe("my emails are many");
    });
    test("are not corrected again by the words list", () => {
        expect(correct("my name", list([["Brooklyn", ["brooklin"]]], [["my name", "Brooklin"]]))).toBe("Brooklin");
    });
    test("keep a line break in what they write", () => {
        expect(correct("my address", list([], [["my address", "1 Road\nTown"]]))).toBe("1 Road\nTown");
    });
});

test("nothing to do leaves the text as it is", () => {
    expect(correct("  keep   this  ", nothing())).toBe("  keep   this  ");
    expect(correct("", list([["A"]]))).toBe("");
});

describe("keeping the list", () => {
    test("saves and loads", () => {
        const stored: Record<string, string> = {};
        const storage = { getItem: (name: string) => stored[name] ?? null, setItem: (name: string, value: string) => void (stored[name] = value) };
        const custom = list([["Siobhan", ["shivon"]]], [["my email", "me@example.com"]]);
        expect(save(custom, storage)).toBe(true);
        expect(load(storage)).toEqual(custom);
    });
    test("loads nothing from nothing, from rubbish, and from a storage that refuses", () => {
        expect(load({ getItem: () => null })).toEqual(nothing());
        expect(load({ getItem: () => "{not json" })).toEqual(nothing());
        expect(load({ getItem: () => JSON.stringify({ words: [{ word: 3 }, { word: " " }, { word: "Ok", sounds: [1, "fine"] }], shortcuts: [{ say: "a" }] }) })).toEqual(list([["Ok", ["fine"]]]));
        expect(
            load({
                getItem: () => {
                    throw new Error("blocked");
                },
            }),
        ).toEqual(nothing());
    });
    test("says so when the browser refuses", () => {
        expect(
            save(nothing(), {
                setItem: () => {
                    throw new Error("full");
                },
            }),
        ).toBe(false);
    });
});
