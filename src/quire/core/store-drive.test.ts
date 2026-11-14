// What the Google Drive store is held to, against the Drive kept in memory (drive.ts); Google is
// never called. Documents are made, listed, opened, saved, renamed and taken away, and a second
// device with the passphrase sees them; a save over a newer version is refused with theirs, and so is
// one that lands in the moment between the check and the write, theirs put back on top; two devices
// changing the list at once both keep their change; a wrong passphrase is said as that and writes
// nothing; a refused token asks for sign-in while the text waits to be saved; a changed or swapped
// file is said to be damaged; pictures are locked too; and nothing Drive is sent holds a name, a word
// of text or a picture's bytes. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { memoryDrive, SignInNeeded } from "./drive";
import { createSaver } from "./store";
import { findVault, FOLDER_NAME, openVault, writeChecked } from "./store-drive";
import { WrongPassphrase } from "./vault";

const PASSPHRASE = "a long passphrase for tests";
// a quick key: the iterations are not what these tests are about
const QUICK = { iterations: 1000 };
const open = (drive: ReturnType<typeof memoryDrive>, passphrase = PASSPHRASE, onSignInNeeded?: () => void) => openVault(drive.drive, passphrase, { ...QUICK, onSignInNeeded });
const contains = (haystack: Uint8Array, needle: string) => {
    const bytes = new TextEncoder().encode(needle);
    outer: for (let at = 0; at + bytes.length <= haystack.length; at++) {
        for (let step = 0; step < bytes.length; step++) if (haystack[at + step] !== bytes[step]) continue outer;
        return true;
    }
    return false;
};

test("a new vault is made with its folder, lock and index; documents are made, listed newest first, opened and saved", async () => {
    let time = 1000;
    const drive = memoryDrive(() => (time += 1000));
    expect(await findVault(drive.drive)).toEqual({ files: 0 });
    const store = await open(drive);
    expect(store.label).toBe("Google Drive");
    const found = await findVault(drive.drive);
    expect(found.lock && found.index && found.folder).toBeTruthy();
    expect([...drive.files.values()].find((file) => file.folder)?.name).toBe(FOLDER_NAME);
    const first = await store.create("Letters home", "Dear all,\n");
    const second = await store.create("Letters home", "Again\n", { style: "{}", notes: "{}" });
    expect((await store.list()).map((entry) => entry.name)).toEqual(["Letters home-2", "Letters home"]);
    const opened = await store.open(first.id);
    expect(opened).toEqual({ text: "Dear all,\n", mark: first.mark });
    const saved = await store.save(first.id, "Dear all, é \u{1F600}\n", opened.mark);
    expect(saved.ok).toBe(true);
    expect((await store.open(first.id)).text).toBe("Dear all, é \u{1F600}\n");
    expect((await store.list())[0]!.id).toBe(first.id);
    expect((await store.open(second.id)).quire).toEqual({ style: "{}", notes: "{}" });
});

test("another device with the passphrase sees the same documents, and a wrong passphrase is said as exactly that and writes nothing", async () => {
    const drive = memoryDrive();
    const one = await open(drive);
    const made = await one.create("Shared", "words");
    const two = await open(drive);
    expect((await two.list()).map((entry) => entry.name)).toEqual(["Shared"]);
    expect((await two.open(made.id)).text).toBe("words");
    const files = drive.files.size;
    const before = drive.received.length;
    const wrong = await open(drive, "not the passphrase").catch((error) => error);
    expect(wrong).toBeInstanceOf(WrongPassphrase);
    expect(wrong.message).toBe("That passphrase is wrong.");
    expect(drive.files.size).toBe(files);
    expect(drive.received.length).toBe(before);
});

test("renaming changes only the locked index, and taking a document away puts its files in Drive's bin", async () => {
    const drive = memoryDrive();
    const store = await open(drive);
    const made = await store.create("Draft", "text");
    await store.savePicture(made.id, new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])]), "cat.png");
    await store.create("Better", "other");
    expect(await store.rename(made.id, "Better")).toBe(made.id);
    expect((await store.list()).map((entry) => entry.name).sort()).toEqual(["Better", "Better-2"]);
    expect((await store.open(made.id)).text).toBe("text");
    const files = [...drive.files.values()].filter((file) => !file.folder).length;
    await store.remove(made.id);
    expect((await store.list()).map((entry) => entry.name)).toEqual(["Better"]);
    expect([...drive.files.values()].filter((file) => file.trashed).length).toBe(2);
    expect([...drive.files.values()].filter((file) => !file.folder && !file.trashed).length).toBe(files - 2);
    expect(await store.open(made.id).then(() => "", String)).toContain("no longer in Google Drive");
});

test("a save over a version saved elsewhere is refused with their text, and Drive keeps theirs", async () => {
    const drive = memoryDrive();
    const here = await open(drive);
    const made = await here.create("Notes", "start");
    const there = await open(drive);
    const theirs = await there.open(made.id);
    expect((await there.save(made.id, "theirs", theirs.mark)).ok).toBe(true);
    const refused = await here.save(made.id, "mine", made.mark);
    expect(refused).toMatchObject({ ok: false, changed: true, theirs: { text: "theirs" } });
    expect((await there.open(made.id)).text).toBe("theirs");
    // keep mine: saved over theirs with their mark, as the conflict screen's choice does
    const kept = await here.save(made.id, "mine", (refused as { theirs: { mark: string } }).theirs.mark);
    expect(kept.ok).toBe(true);
    expect((await there.open(made.id)).text).toBe("mine");
});

test("a save that lands in the moment between the check and the write is refused, theirs put back on top, and theirs saves on without a false alarm", async () => {
    const drive = memoryDrive();
    const here = await open(drive);
    const made = await here.create("Race", "start");
    const there = await open(drive);
    let theirMark = "";
    // the other device saves after this one has checked the head, before its bytes land
    drive.between(async () => {
        const saved = await there.save(made.id, "theirs", made.mark);
        if (saved.ok) theirMark = saved.mark;
    });
    const refused = await here.save(made.id, "mine", made.mark);
    expect(theirMark).not.toBe("");
    expect(refused).toMatchObject({ ok: false, changed: true, theirs: { text: "theirs" } });
    expect((await here.open(made.id)).text).toBe("theirs");
    // the device whose save won goes on from its own mark: the copy put back is not a change
    const next = await there.save(made.id, "theirs, and more", theirMark);
    expect(next.ok).toBe(true);
    expect((await here.open(made.id)).text).toBe("theirs, and more");
});

test("two devices changing the list of documents at once both keep their change", async () => {
    const drive = memoryDrive();
    const one = await open(drive);
    const two = await open(drive);
    await one.list();
    await two.list();
    // while the first writes the index, the second makes a document and writes it first
    drive.between(async () => void (await two.create("From two", "b")));
    await one.create("From one", "a");
    expect((await one.list()).map((entry) => entry.name).sort()).toEqual(["From one", "From two"]);
    expect((await two.list()).map((entry) => entry.name).sort()).toEqual(["From one", "From two"]);
    // and a rename on one device made over an index read before the other's change
    await two.rename((await two.list()).find((entry) => entry.name === "From one")!.id, "Renamed by two");
    await one.create("Third", "c");
    expect((await one.list()).map((entry) => entry.name).sort()).toEqual(["Renamed by two", "From two", "Third"].sort());
});

test("when the token runs out the writer is asked to sign in, the text waits, and after signing in it is saved", async () => {
    const drive = memoryDrive();
    let asked = 0;
    const store = await open(drive, PASSPHRASE, () => asked++);
    const made = await store.create("Long", "start");
    const saver = createSaver(store, made.id, made.mark, { wait: () => () => {} });
    drive.expire();
    saver.changed("typed while signed out");
    await saver.flush();
    expect(saver.status()).toEqual({ state: "failed", message: new SignInNeeded().message });
    expect(saver.unsaved()).toBe("typed while signed out");
    expect(asked).toBeGreaterThan(0);
    drive.signIn();
    await saver.flush();
    expect(saver.status().state).toBe("saved");
    expect((await store.open(made.id)).text).toBe("typed while signed out");
});

test("a changed byte, a file put in another's place, or a changed index is said to be damaged, not opened", async () => {
    const drive = memoryDrive();
    const store = await open(drive);
    const one = await store.create("One", "first words");
    const two = await store.create("Two", "second words");
    const fileOf = (text: string) => [...drive.files.values()].find((file) => !file.folder && file.revisions.at(-1)!.bytes.length === new TextEncoder().encode(JSON.stringify({ text })).length + 51)!;
    const first = fileOf("first words");
    const second = fileOf("second words");
    const original = first.revisions.at(-1)!.bytes;
    const changed = original.slice();
    changed[changed.length - 20]! ^= 1;
    first.revisions.push({ id: "r-changed", bytes: changed, kept: true });
    expect(await store.open(one.id).then(() => "", String)).toContain("damaged or was changed outside mdQuire");
    // the other document's locked bytes, put in this one's file: they do not open under this one's key
    first.revisions.push({ id: "r-swapped", bytes: second.revisions.at(-1)!.bytes, kept: true });
    expect(await store.open(one.id).then(() => "", String)).toContain("damaged or was changed outside mdQuire");
    expect((await store.open(two.id)).text).toBe("second words");
    const index = [...drive.files.values()].find((file) => file.name === "index")!;
    const bad = index.revisions.at(-1)!.bytes.slice();
    bad[40]! ^= 1;
    index.revisions.push({ id: "r-index", bytes: bad, kept: true });
    expect(await store.list().then(() => "", String)).toContain("list of documents in Google Drive is damaged");
});

test("pictures are locked too, shown from the document and given back for a download", async () => {
    const drive = memoryDrive();
    const store = await open(drive);
    const made = await store.create("With a picture", "![a cat](pictures/cat.png)", { style: "", notes: "" });
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    expect(await store.savePicture(made.id, new Blob([bytes]), "my cat.png")).toBe("pictures/my-cat.png");
    expect(await store.savePicture(made.id, new Blob([bytes]), "my cat.png")).toBe("pictures/my-cat-2.png");
    const pictures = await store.pictures!(made.id);
    expect([...pictures.keys()]).toEqual(["my-cat.png", "my-cat-2.png"]);
    expect([...new Uint8Array(await pictures.get("my-cat.png")!.arrayBuffer())]).toEqual([...bytes]);
    expect(pictures.get("my-cat.png")!.type).toBe("image/png");
    const shown = await store.show!(made.id, "pictures/my-cat.png");
    expect(shown?.startsWith("blob:")).toBe(true);
    expect(await store.show!(made.id, "pictures/none.png")).toBeUndefined();
});

test("nothing Drive is sent holds a document's name, a word of its text or a picture's bytes", async () => {
    const drive = memoryDrive();
    const store = await open(drive);
    const made = await store.create("Secret diary title", "Secret diary text, with many words in it.\n", { style: '{"secret":"style"}', notes: '{"secret":"note"}' });
    await store.save(made.id, "Secret diary text, longer now, still private.\n", made.mark, { style: "", notes: "" });
    const picture = new TextEncoder().encode("PICTUREBYTES-private-picture-bytes");
    await store.savePicture(made.id, new Blob([picture]), "private photo.png");
    await store.rename(made.id, "Renamed secret title");
    const words = ["Secret", "secret", "diary", "words", "private", "PICTUREBYTES", "photo", "Renamed", "title", "style", "note", "text"];
    expect(drive.received.length).toBeGreaterThan(8);
    for (const sent of drive.received) {
        if (typeof sent === "string") {
            // the names Drive learns: the app's folder, the lock, the index, and random keys
            expect(sent === FOLDER_NAME || sent === "lock" || sent === "index" || /^[0-9a-f]{32}$/.test(sent)).toBe(true);
            continue;
        }
        for (const word of words) expect(contains(sent, word)).toBe(false);
    }
});

test("the revision before a save is let go once the save is in place, so that few are kept", async () => {
    const drive = memoryDrive();
    const store = await open(drive);
    const made = await store.create("Many saves", "0");
    let mark = made.mark;
    for (let count = 1; count <= 10; count++) {
        const saved = await store.save(made.id, String(count), mark);
        if (!saved.ok) throw new Error("not saved");
        mark = saved.mark;
    }
    const file = [...drive.files.values()].find((each) => each.revisions.length === 11)!;
    expect(file.revisions.filter((each) => each.kept).map((each) => each.id)).toEqual([mark]);
});

test("a checked write refuses a head that moved on, and passes a head that is a byte for byte copy of the mark", async () => {
    const memory = memoryDrive();
    const { drive } = memory;
    await drive.folder("f");
    const made = await drive.create("x", new Uint8Array([1]), "folder1");
    const moved = await drive.write(made.id, new Uint8Array([2]));
    expect(await writeChecked(drive, made.id, new Uint8Array([3]), made.revision)).toMatchObject({ ok: false, theirs: { revision: moved } });
    const copy = await drive.write(made.id, new Uint8Array([1]));
    const passed = await writeChecked(drive, made.id, new Uint8Array([4]), made.revision);
    expect(passed.ok).toBe(true);
    expect(copy).not.toBe(made.revision);
});
