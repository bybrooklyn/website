// Which card of the minis list runs: the one pointed at, or else the first in view.
import { expect, test } from "bun:test";
import { liveCard } from "./minis-list";

test("the card pointed at runs, wherever it is", () => {
    expect(liveCard(["a", "b", "c"], "c", new Set(["a", "b"]))).toBe("c");
});

test("with none pointed at, the first card in view runs", () => {
    expect(liveCard(["a", "b", "c"], undefined, new Set(["c", "b"]))).toBe("b");
});

test("with none pointed at and none in view, none runs", () => {
    expect(liveCard(["a", "b"], undefined, new Set())).toBeUndefined();
});
