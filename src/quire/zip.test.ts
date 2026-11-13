// What the zip reader and writer are held to: the checksum is the standard one, what is written
// reads back the same, a file written here opens with the system's `unzip`, and one made by the
// system's `zip` opens here. Run with `bun test src/quire/zip.test.ts`.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, LIMITS, readZip, writeZip, ZipError } from "./zip";

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);
const folder = () => mkdtempSync(join(tmpdir(), "quire-zip-"));

test("CRC-32 gives the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
});

test("files written into a zip read back the same, squeezed or stored, with UTF-8 names", async () => {
    const picture = new Uint8Array(3000).map((_, index) => (index * 7919) % 256);
    const long = "A line said again and again.\n".repeat(200);
    const bytes = await writeZip([
        { name: "document.md", data: long },
        { name: "pictures/café.png", data: picture, store: true },
        { name: "empty.json", data: "" },
    ]);
    // the text was squeezed: the whole zip is smaller than the text alone
    expect(bytes.length).toBeLessThan(long.length);
    const files = await readZip(bytes);
    expect([...files.keys()]).toEqual(["document.md", "pictures/café.png", "empty.json"]);
    expect(text(files.get("document.md"))).toBe(long);
    expect(files.get("pictures/café.png")).toEqual(picture);
    expect(text(files.get("empty.json"))).toBe("");
});

test("a zip written here opens with the system's unzip, which finds nothing wrong", async () => {
    const where = folder();
    const path = join(where, "made-here.quire");
    writeFileSync(path, await writeZip([{ name: "document.md", data: "# Hello\n\nWords and words and words, words.\n" }, { name: "pictures/a.bin", data: new Uint8Array([1, 2, 3]), store: true }]));
    const checked = Bun.spawnSync(["unzip", "-t", path]);
    expect(checked.exitCode).toBe(0);
    expect(checked.stdout.toString()).toContain("No errors detected");
    const shown = Bun.spawnSync(["unzip", "-p", path, "document.md"]);
    expect(shown.stdout.toString()).toBe("# Hello\n\nWords and words and words, words.\n");
});

test("a zip made by the system's zip opens here, deflated and stored entries both", async () => {
    const where = folder();
    writeFileSync(join(where, "document.md"), "Some text that zip will squeeze. ".repeat(50));
    writeFileSync(join(where, "small.txt"), "x");
    const made = Bun.spawnSync(["zip", "-q", "-r", "made-there.zip", "document.md", "small.txt"], { cwd: where });
    expect(made.exitCode).toBe(0);
    const files = await readZip(new Uint8Array(readFileSync(join(where, "made-there.zip"))));
    expect(text(files.get("document.md"))).toBe("Some text that zip will squeeze. ".repeat(50));
    expect(text(files.get("small.txt"))).toBe("x");
});

test("something that is not a zip, or a damaged one, is refused in plain words", async () => {
    expect(readZip(new TextEncoder().encode("just some text, not a zip at all"))).rejects.toBeInstanceOf(ZipError);
    const bytes = await writeZip([{ name: "a.txt", data: "hello there", store: true }]);
    bytes[30 + "a.txt".length] = "j".charCodeAt(0);
    expect(readZip(bytes)).rejects.toThrow("a.txt is damaged");
});

/** Where each line of a zip's directory starts, so a test can change what it says. */
function directoryLines(bytes: Uint8Array): number[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const found: number[] = [];
    for (let at = 0; at + 4 <= bytes.length; at++) if (view.getUint32(at, true) === 0x02014b50) found.push(at);
    return found;
}
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

test("a zip that says it unpacks to more than the limits is refused before anything is unpacked", async () => {
    // one entry larger than a document's file may be
    const one = await writeZip([{ name: "document.md", data: "x".repeat(100) }]);
    view(one).setUint32(directoryLines(one)[0]! + 24, LIMITS.entry + 1, true);
    await expect(readZip(one)).rejects.toThrow("document.md is too big to open here");
    // several that come to more than the whole may
    const many = await writeZip([1, 2, 3].map((each) => ({ name: `pictures/${each}.png`, data: "y".repeat(50) })));
    for (const line of directoryLines(many)) view(many).setUint32(line + 24, 100 * 1024 * 1024, true);
    await expect(readZip(many)).rejects.toThrow("this zip unpacks to more than can be opened here");
    // more files than a document has
    const crowd = await writeZip([{ name: "a.txt", data: "a" }]);
    const tail = crowd.length - 22;
    view(crowd).setUint16(tail + 8, LIMITS.entries + 1, true);
    view(crowd).setUint16(tail + 10, LIMITS.entries + 1, true);
    await expect(readZip(crowd)).rejects.toThrow(`more than ${LIMITS.entries} files`);
});

test("a squeezed file that unpacks to more than it said is stopped as soon as it passes that, not unpacked whole", async () => {
    // twenty megabytes of zeros squeeze to a few kilobytes; the directory says ten bytes
    const bomb = await writeZip([{ name: "document.md", data: new Uint8Array(20 * 1024 * 1024) }]);
    for (const line of directoryLines(bomb)) view(bomb).setUint32(line + 24, 10, true);
    expect(bomb.length).toBeLessThan(100_000);
    const started = performance.now();
    await expect(readZip(bomb)).rejects.toThrow("document.md is damaged");
    expect(performance.now() - started).toBeLessThan(2000);
});

test("names that would reach outside the zip, two files of one name, and odd names are refused", async () => {
    for (const name of ["../evil.txt", "pictures/../../evil.png", "/etc/passwd", "\\evil.txt", "pictures\\..\\evil.png", "C:/evil.txt", "pictures/a\u0000b.png", "./document.md"]) {
        const bytes = await writeZip([{ name: "document.md", data: "hi" }, { name, data: "x" }]);
        await expect(readZip(bytes)).rejects.toThrow("outside itself");
    }
    const twice = await writeZip([{ name: "document.md", data: "first" }, { name: "document.md", data: "second" }]);
    await expect(readZip(twice)).rejects.toThrow("two files named document.md");
});

test("a zip cut short, pointing past its end, packed some other way is refused in plain words", async () => {
    const whole = await writeZip([{ name: "document.md", data: "Some words, said again and again. ".repeat(20) }, { name: "b.txt", data: "b", store: true }]);
    for (const cut of [10, 40, whole.length - 30, whole.length - 1]) await expect(readZip(whole.subarray(0, cut))).rejects.toBeInstanceOf(ZipError);
    const far = whole.slice();
    view(far).setUint32(directoryLines(far)[1]! + 42, far.length + 1000, true);
    await expect(readZip(far)).rejects.toThrow("this zip is damaged");
    const other = whole.slice();
    view(other).setUint16(directoryLines(other)[0]! + 10, 12, true);
    await expect(readZip(other)).rejects.toThrow("packed in a way this cannot open");
});
