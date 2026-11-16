// What a converter's error carries: its words, its line and what can be done, and that it is an Error.

import { expect, test } from "bun:test";
import { DataError } from "./errors";

test("a data error keeps its words, its line and its offer, and is an Error", () => {
    const error = new DataError("Line 3 is wrong.", { line: 3, offer: { key: "flatten", words: "Flatten it." } });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Line 3 is wrong.");
    expect(error.line).toBe(3);
    expect(error.offer?.key).toBe("flatten");
    expect(new DataError("Plain.").line).toBeUndefined();
});
