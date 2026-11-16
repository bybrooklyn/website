// What the converter's names and sizes are held to: a file keeps its own name with the new ending, two
// of one name become "photo.webp" and "photo (1).webp" and nothing is given twice, names a disk cannot
// hold are made plain, and sizes and times are said in plain units.

import { expect, test } from "bun:test";
import { changeSaid, outName, plainName, readWeight, sizeSaid, stemOf, timeSaid } from "./names";

test("a file keeps its own name with the new ending, and a second of one name gets a number in brackets", () => {
    const taken = new Set<string>();
    expect(outName("photo.jpg", ".webp", taken)).toBe("photo.webp");
    expect(outName("photo.png", ".webp", taken)).toBe("photo (1).webp");
    expect(outName("Photo.heic", ".webp", taken)).toBe("Photo (2).webp");
    expect(outName("photo.webp", ".webp", taken)).toBe("photo (3).webp");
    expect(outName("photo.jpg", ".avif", taken)).toBe("photo.avif");
});

test("a name already in the folder is never given, whatever its case", () => {
    const taken = new Set(["notes.json", "notes (1).json"]);
    expect(outName("Notes.csv", ".json", taken)).toBe("Notes (2).json");
});

test("the ending is what follows the last dot, and a name with no ending or only a leading dot keeps it whole", () => {
    expect(stemOf("archive.tar.gz")).toBe("archive.tar");
    expect(stemOf("README")).toBe("README");
    expect(stemOf(".env")).toBe(".env");
    expect(stemOf("folder/song.flac")).toBe("song");
});

test("characters no disk takes become hyphens and an empty name becomes file", () => {
    expect(plainName('a:b*c?"d<e>f|g')).toBe("a-b-c-d-e-f-g");
    expect(plainName("...")).toBe("file");
    expect(outName("", ".txt", new Set())).toBe("file.txt");
});

test("sizes are said in units of a thousand with at most three figures", () => {
    expect(sizeSaid(0)).toBe("0 bytes");
    expect(sizeSaid(1)).toBe("1 byte");
    expect(sizeSaid(999)).toBe("999 bytes");
    expect(sizeSaid(1000)).toBe("1.0 KB");
    expect(sizeSaid(412_300)).toBe("412 KB");
    expect(sizeSaid(3_420_000)).toBe("3.4 MB");
    expect(sizeSaid(34_200_000)).toBe("34 MB");
    expect(sizeSaid(1_250_000_000)).toBe("1.3 GB");
});

test("a weight typed is read in kilobytes unless it says otherwise, and nothing under a kilobyte", () => {
    expect(readWeight("200")).toBe(200_000);
    expect(readWeight("200 KB")).toBe(200_000);
    expect(readWeight("1.5 MB")).toBe(1_500_000);
    expect(readWeight("5000 bytes")).toBe(5000);
    expect(readWeight("12 b")).toBeUndefined();
    expect(readWeight("lots")).toBeUndefined();
});

test("times read as a clock and changes in size as a share", () => {
    expect(timeSaid(7.4)).toBe("0:07");
    expect(timeSaid(205)).toBe("3:25");
    expect(timeSaid(3729)).toBe("1:02:09");
    expect(changeSaid(1000, 380)).toBe("62% smaller");
    expect(changeSaid(1000, 1080)).toBe("8% larger");
    expect(changeSaid(1000, 1001)).toBe("the same size");
});
