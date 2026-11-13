// Words never offered: no suggestion for any misspelling in either fixture (the repo's own pairs and a
// hundred more from an audit, misspellings-audit.fixture.txt) nor for the slips an audit found
// offering a slur or a vulgar word is withheld, while the withheld words stay known to the speller.
// And words run together are offered apart only when both are common words.

import { expect, test } from "bun:test";
import { unpackDictionary } from "./dictionary";
import { WITHHELD, withheld } from "./withheld";

const words = await unpackDictionary(await Bun.file(new URL("../../../public/quire/words-en.dat", import.meta.url).pathname).arrayBuffer());
const pairs = async (name: string) => (await Bun.file(new URL(name, import.meta.url).pathname).text()).trim().split("\n").map((line) => [line.slice(0, line.indexOf(" ")), line.slice(line.indexOf(" ") + 1)] as const);

test("no suggestion for a misspelling in either fixture, or for the slips that once offered one, is a withheld word", async () => {
    const wrong = [...(await pairs("./misspellings.fixture.txt")), ...(await pairs("./misspellings-audit.fixture.txt"))].map(([one]) => one);
    expect(wrong.length).toBeGreaterThan(280);
    // the slips an audit found putting a slur or a vulgar word in the first three
    wrong.push("comming", "cion", "ocunt", "tetx", "tets", "asys", "dilaog", "shirt", "bitc", "fcuk", "cuont", "retared", "nigt", "fagot");
    for (const dialect of ["us", "gb"] as const) for (const one of wrong) expect([one, words.suggest(one, dialect, 6).filter(withheld)]).toEqual([one, []]);
});

test("withheld words are in the dictionary, so typing one on purpose is not a misspelling", () => {
    const known = [...WITHHELD].filter((word) => words.known(word, "us") || words.known(word, "gb"));
    expect(known.length).toBe(WITHHELD.size);
    expect(WITHHELD.size).toBeGreaterThan(30);
    expect(WITHHELD.size).toBeLessThan(250);
    expect(withheld("Fuck")).toBe(true);
    expect(withheld("queer")).toBe(false);
});

test("two words run together are offered apart only when both are common words", () => {
    expect(words.suggest("alot", "us")).toContain("a lot");
    expect(words.suggest("eachother", "us")[0]).toBe("each other");
    expect(words.suggest("thankyou", "us")[0]).toBe("thank you");
    for (const [wrong, nonsense] of [["publically", "public ally"], ["occured", "occur ed"], ["adress", "a dress"], ["wensday", "wens day"], ["colour", "col our"], ["developement", "dev elopement"], ["mantain", "manta in"]]) expect(words.suggest(wrong!, "us")).not.toContain(nonsense);
});
