// What version history is held to: it counts the lines added and removed between two texts,
// thins old snapshots so that no more than fifty stay and older ones are further apart, keeps
// its snapshots in storage, and takes one on opening and one after each pause in editing, and
// no more. Run with `bun test src/quire`.

import { expect, test } from "bun:test";
import { setStyle } from "./document";
import { emptyParts, opened, written } from "./quire-file";
import { changes, createKeeper, KEPT, memoryStorage, snapshotDocument, snapshotParts, snapshotText, thin, when } from "./versions";
import { write } from "./write";

test("a .quire document's snapshot carries its styling, and restoring it brings back the typeface, highlight and spacing", () => {
    const styled = setStyle(opened("A line of words\n", emptyParts()), { start: { path: [0], offset: 2 }, end: { path: [0], offset: 6 } }, { font: "serif", highlight: "yellow" });
    const spaced = { ...styled, blocks: styled.blocks.map((block) => (block.kind === "paragraph" ? { ...block, spacing: 2 } : block)) };
    const { text, quire } = written(spaced, write);
    const saved = snapshotText(text, quire);
    expect(snapshotParts(saved)).toEqual({ markdown: "A line of words\n", parts: quire });
    const back = snapshotDocument(saved, opened("Something else\n", emptyParts()));
    expect(written(back, write)).toEqual({ text, quire });
    const block = back.blocks[0]!;
    expect(block.kind === "paragraph" && block.spacing).toBe(2);
    expect(JSON.stringify(block)).toContain('"font":"serif"');
    expect(JSON.stringify(block)).toContain('"highlight":"yellow"');
});

test("a Markdown snapshot, or one kept before styling was, restores as Markdown and keeps the page it is restored into", () => {
    expect(snapshotParts("# Plain\n")).toEqual({ markdown: "# Plain\n" });
    const into = opened("x\n", emptyParts());
    const back = snapshotDocument("# Plain\n", into);
    expect(back.quire).toEqual(into.quire);
    expect(write(back)).toBe("# Plain\n");
    expect(snapshotDocument("# Plain\n", opened("x\n", undefined)).quire).toBeUndefined();
});

test("the lines added and removed are counted in the Markdown alone, not in the styling kept after it", async () => {
    const storage = memoryStorage();
    let text = snapshotText("one\n", { style: "{}", notes: "" });
    const keeper = createKeeper(storage, "doc", () => text, { wait: () => () => {} });
    await keeper.opened();
    text = snapshotText("one\ntwo\n", { style: '{\n"a": 1\n}', notes: "" });
    expect(await keeper.now()).toMatchObject({ added: 1, removed: 0 });
});

test("the lines added and removed between two texts are counted", () => {
    expect(changes("a\nb\nc\n", "a\nb\nc\n")).toEqual({ added: 0, removed: 0 });
    expect(changes("a\nb\nc", "a\nx\nb\nc")).toEqual({ added: 1, removed: 0 });
    expect(changes("a\nb\nc", "a\nc")).toEqual({ added: 0, removed: 1 });
    expect(changes("a\nb\nc", "a\nB\nc")).toEqual({ added: 1, removed: 1 });
    expect(changes("", "one\ntwo")).toEqual({ added: 2, removed: 0 });
    expect(changes("a\r\nb", "a\nb")).toEqual({ added: 0, removed: 0 });
    expect(changes("x\ny\nz\nw", "w\nx\ny\nz")).toEqual({ added: 1, removed: 1 });
});

test("a snapshot every minute for two days is thinned to fifty, older ones further apart", () => {
    const now = 2 * 86_400_000;
    const all = Array.from({ length: 2 * 24 * 60 }, (_, index) => ({ id: String(index), time: index * 60_000 }));
    const gone = new Set(thin(all, now));
    const kept = all.filter((each) => !gone.has(each.id)).sort((a, b) => b.time - a.time);
    expect(kept.length).toBeLessThanOrEqual(KEPT);
    expect(kept.length).toBeGreaterThan(KEPT / 2);
    expect(kept[0]!.time).toBe(all[all.length - 1]!.time);
    expect(kept[kept.length - 1]!.time).toBe(0);
    // the gaps between kept snapshots grow with their age
    const gaps = kept.slice(1, -1).map((each, index) => kept[index]!.time - each.time);
    const recent = gaps.slice(0, 8).reduce((sum, gap) => sum + gap, 0) / 8;
    const old = gaps.slice(-8).reduce((sum, gap) => sum + gap, 0) / 8;
    expect(old).toBeGreaterThan(recent * 4);
});

test("a few snapshots are not thinned at all, and the newest and oldest always stay", () => {
    expect(thin([{ id: "a", time: 0 }, { id: "b", time: 10 }], 100)).toEqual([]);
    const close = Array.from({ length: 5 }, (_, index) => ({ id: String(index), time: 1000 + index }));
    expect(thin(close, 1_000_000_000)).not.toContain("4");
    expect(thin(close, 1_000_000_000)).not.toContain("0");
});

test("snapshots kept in memory come back newest first, and can be loaded and removed", async () => {
    const storage = memoryStorage();
    const first = await storage.save("doc", "one", { time: 1, added: 1, removed: 0 });
    await storage.save("doc", "two", { time: 2, added: 1, removed: 1 });
    await storage.save("other", "x", { time: 3, added: 1, removed: 0 });
    expect((await storage.list("doc")).map((each) => each.time)).toEqual([2, 1]);
    expect(await storage.load(first.id)).toBe("one");
    await storage.remove(first.id);
    expect((await storage.list("doc")).length).toBe(1);
});

test("one snapshot is taken on opening and one after each pause in editing, and none for no change", async () => {
    const storage = memoryStorage();
    let text = "first\n";
    let clock = 0;
    let pending: (() => void) | undefined;
    const keeper = createKeeper(storage, "doc", () => text, {
        now: () => clock,
        wait: (run) => {
            pending = run;
            return () => (pending = undefined);
        },
    });
    await keeper.opened();
    expect(await storage.list("doc")).toMatchObject([{ opened: true, added: 1, removed: 0 }]);

    // typing, with no pause yet: nothing more is kept
    text = "first\nsecond\n";
    keeper.edited();
    text = "first\nsecond\nthird\n";
    keeper.edited();
    expect((await storage.list("doc")).length).toBe(1);
    // the pause comes: one snapshot, with what changed since the last
    clock = 60_000;
    pending?.();
    await keeper.settled();
    const versions = await storage.list("doc");
    expect(versions.length).toBe(2);
    expect(versions[0]).toMatchObject({ added: 2, removed: 0, time: 60_000 });
    // a pause after an edit that changed nothing back keeps nothing
    keeper.edited();
    pending?.();
    await keeper.settled();
    expect((await storage.list("doc")).length).toBe(2);
    // opening the same text again is not kept twice
    await keeper.opened();
    expect((await storage.list("doc")).length).toBe(2);
});

test("a snapshot's time reads as the hour today, and with its day before that", () => {
    const now = new Date(2026, 10, 12, 15, 0).getTime();
    expect(when(new Date(2026, 10, 12, 9, 5).getTime(), now)).toBe("Today, 09:05");
    expect(when(new Date(2026, 10, 11, 22, 30).getTime(), now)).toBe("Yesterday, 22:30");
    expect(when(new Date(2026, 9, 3, 8, 0).getTime(), now)).toBe("3 Oct, 08:00");
    expect(when(new Date(2025, 9, 3, 8, 0).getTime(), now)).toBe("3 Oct 2025, 08:00");
});

test("a stopped keeper, for a document that was left, keeps no snapshot of what is shown after it", async () => {
    const storage = memoryStorage();
    let text = "the old document\n";
    let pending: (() => void) | undefined;
    const keeper = createKeeper(storage, "old", () => text, {
        wait: (run) => {
            pending = run;
            return () => (pending = undefined);
        },
    });
    await keeper.opened();
    keeper.stop();
    // the next document is drawn, and its change is told to the old keeper too
    text = "the new document\n";
    keeper.edited();
    pending?.();
    await keeper.now();
    await keeper.settled();
    const kept = await storage.list("old");
    expect(kept.length).toBe(1);
    expect(await storage.load(kept[0]!.id)).toBe("the old document\n");
});
