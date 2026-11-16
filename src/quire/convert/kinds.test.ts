// What finding a file's kind is held to: the first bytes win over a wrong ending, each picture, sound
// and film format the converter knows is told apart by them, an M4A is a sound and an MP4 a film,
// a HEIC from a phone named .jpeg is a picture, and text is found by its ending or by reading as text.

import { expect, test } from "bun:test";
import { kindOf, looksLikeText } from "./kinds";

const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((part) => (typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part)));
const ftyp = (major: string, ...compatible: string[]) => bytes([0, 0, 0, 16 + compatible.length * 4], "ftyp", major, [0, 0, 0, 0], ...compatible);

test("the first bytes win over the name: a PNG named .jpg is a PNG", () => {
    expect(kindOf(bytes([0x89], "PNG\r\n", [0x1a, 0x0a]), "photo.jpg", "image/jpeg")).toEqual({ kind: "picture", format: "png", label: "PNG picture" });
});

test("each picture format is told apart by its first bytes", () => {
    expect(kindOf(bytes([0xff, 0xd8, 0xff, 0xe0])).format).toBe("jpeg");
    expect(kindOf(bytes("GIF89a")).format).toBe("gif");
    expect(kindOf(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 ")).format).toBe("webp");
    expect(kindOf(ftyp("avif", "mif1", "miaf")).format).toBe("avif");
    expect(kindOf(ftyp("heic", "mif1", "heic"), "IMG_0001.jpeg").format).toBe("heic");
    expect(kindOf(bytes([0xff, 0x0a])).format).toBe("jxl");
    expect(kindOf(bytes([0, 0, 0, 0x0c], "JXL ", [0x0d, 0x0a, 0x87, 0x0a])).format).toBe("jxl");
    expect(kindOf(bytes("BM", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).format).toBe("bmp");
    expect(kindOf(bytes([0x49, 0x49, 0x2a, 0])).format).toBe("tiff");
});

test("each sound format is told apart, an Opus file in Ogg from other Ogg files, ADTS AAC from MP3", () => {
    expect(kindOf(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt ")).format).toBe("wav");
    expect(kindOf(bytes("fLaC")).format).toBe("flac");
    const ogg = (codec: string) => bytes("OggS", new Array(24).fill(0), codec);
    expect(kindOf(ogg("OpusHead")).format).toBe("opus");
    expect(kindOf(ogg("\x01vorbis")).format).toBe("ogg");
    expect(kindOf(bytes("ID3", [4, 0])).format).toBe("mp3");
    expect(kindOf(bytes([0xff, 0xfb, 0x90, 0x64])).format).toBe("mp3");
    expect(kindOf(bytes([0xff, 0xf1, 0x50, 0x80])).format).toBe("aac");
    expect(kindOf(bytes("FORM", [0, 0, 0, 0], "AIFF")).format).toBe("aiff");
});

test("an MP4 is a film, an M4A a sound, a QuickTime file a film, and a WebM by its document type", () => {
    expect(kindOf(ftyp("isom", "isom", "avc1", "mp41"))).toMatchObject({ kind: "video", format: "mp4" });
    expect(kindOf(ftyp("M4A ", "M4A ", "mp42", "isom"))).toMatchObject({ kind: "audio", format: "m4a" });
    expect(kindOf(ftyp("qt  "))).toMatchObject({ kind: "video", format: "mov" });
    const ebml = (type: string) => bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84], type);
    expect(kindOf(ebml("webm"))).toMatchObject({ kind: "video", format: "webm" });
    expect(kindOf(ebml("webm"), "voice.weba")).toMatchObject({ kind: "audio", format: "webm" });
    expect(kindOf(ebml("matroska"))).toMatchObject({ kind: "video", format: "mkv" });
});

test("text is found by its ending, or by reading as text when it has none", () => {
    const text = bytes("name,age\n");
    expect(kindOf(text, "people.csv").format).toBe("csv");
    expect(kindOf(text, "notes.md").format).toBe("md");
    expect(kindOf(text, "settings.yml").format).toBe("yaml");
    expect(kindOf(text, "page.htm").format).toBe("html");
    expect(kindOf(text, "noname")).toMatchObject({ kind: "text", format: "text" });
    expect(kindOf(bytes([0, 1, 2, 3]), "blob.bin").kind).toBe("unknown");
    expect(looksLikeText(new TextEncoder().encode("café, naïve"))).toBe(true);
    expect(looksLikeText(bytes([0xc3, 0x28, 0x41, 0x41, 0x41, 0x41, 0x41]))).toBe(false);
});
