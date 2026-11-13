// The words in the margin about the document (details.ts).

import { expect, test } from "bun:test";
import { ago, keptLine, lengthLine, sizeLine } from "./details";

test("the length says the words and the minutes to read, as a blog counts them", () => {
    expect(lengthLine(0)).toBe("Nothing written yet");
    expect(lengthLine(1)).toBe("1 word, under a minute to read");
    expect(lengthLine(412)).toBe("412 words, 2 minutes to read");
    expect(lengthLine(5000)).toBe("5,000 words, 21 minutes to read");
});

test("where it is kept reads as a phrase, with when it was last saved", () => {
    const now = Date.UTC(2026, 10, 12, 12);
    expect(keptLine("This browser", now - 5_000, now)).toBe("In this browser, a moment ago");
    expect(keptLine("This browser", now - 3 * 60_000, now)).toBe("In this browser, 3 minutes ago");
    expect(keptLine("Repository: me/notes", undefined, now)).toBe("Repository: me/notes");
    expect(keptLine(undefined, undefined, now)).toBe("Not kept anywhere");
    expect(ago(now - 2 * 3_600_000, now)).toBe("2 hours ago");
});

test("the size reads in bytes, then kilobytes and megabytes, with the pictures kept beside it", () => {
    expect(sizeLine(1)).toBe("1 byte");
    expect(sizeLine(640)).toBe("640 bytes");
    expect(sizeLine(3160)).toBe("3.2 KB");
    expect(sizeLine(2_400_000)).toBe("2.4 MB");
    expect(sizeLine(3160, 1)).toBe("3.2 KB, and 1 picture kept beside it");
    expect(sizeLine(3160, 2)).toBe("3.2 KB, and 2 pictures kept beside it");
});
