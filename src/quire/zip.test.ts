// What the zip reader and writer are held to: the checksum is the standard one, what is written
// reads back the same, a file written here opens with the system's `unzip`, and one made by the
// system's `zip` opens here. Run with `bun test src/quire/zip.test.ts`.

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, readZip, writeZip, ZipError } from "./zip";

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
