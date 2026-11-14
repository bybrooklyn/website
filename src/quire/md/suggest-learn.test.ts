// Learning her writing for suggestions: documents in every place given are learned once and kept, so
// a second visit reads the counts back and opens nothing; a save takes back what the document taught
// and learns what it says now; a document changed elsewhere is not counted twice, and enough of them
// learn everything again; forgetting empties it and documents not written in since stay forgotten;
// nothing is suggested until what was kept has been read, and anything broken that was kept is
// passed over.

import { expect, test } from "bun:test";
import { browserStore, memoryTables } from "../core/store-browser";
import { createLearner, documentKey, hashOf, memoryKeeper, type Idle, type Keeper } from "./suggest-learn";

/** Idle time that comes at once and never runs out. */
const always: Idle = (work) => work(() => Infinity);

const story = "I am writing a post about my website and how it works. ".repeat(4);

/** A browser store in memory, with documents in it, its clock set by `time`. */
async function shelf(texts: string[], time = { now: 1000 }) {
    const store = browserStore(memoryTables(), () => time.now);
    const ids: string[] = [];
    for (const [index, text] of texts.entries()) ids.push((await store.create(`Doc ${index}`, text)).id);
    return { store, ids, time };
}

const learner = (stores: () => ReturnType<typeof browserStore>[], keeper: Keeper = memoryKeeper(), now = () => 5000) => createLearner({ stores, keeper, idle: always, now, keepAfter: 0 });

test("documents on the shelf are learned and suggested from", async () => {
    const { store } = await shelf([story, "Something else entirely."]);
    const learning = learner(() => [store]);
    expect(learning.predict("a post about my web")).toBeUndefined();
    await learning.start();
    expect(learning.predict("a post about my web")).toBe("site and how it");
    expect(learning.size().documents).toBe(2);
    learning.stop();
});

test("a second visit reads back what was kept and opens no document again", async () => {
    const { store } = await shelf([story]);
    const keeper = memoryKeeper();
    const first = learner(() => [store], keeper);
    await first.start();
    await new Promise((done) => setTimeout(done, 10));
    await first.settled();
    first.stop();
    expect(keeper.kept?.docs).toHaveLength(1);
    let opened = 0;
    const watched = { ...store, open: (id: string) => (opened++, store.open(id)) };
    const second = learner(() => [watched as never], keeper);
    await second.start();
    expect(opened).toBe(0);
    expect(second.predict("a post about my web")).toBe("site and how it");
    second.stop();
});

test("a save takes back what the document taught and learns what it says now", async () => {
    const { store, ids } = await shelf([story]);
    const learning = learner(() => [store]);
    await learning.start();
    const key = documentKey(store, ids[0]!);
    learning.opened(key, story);
    const now = "The light was gold that evening. ".repeat(4);
    await learning.saved(key, now);
    expect(learning.predict("a post about my web")).toBeUndefined();
    expect(learning.predict("The light was ")).toBe("gold that evening");
    expect(learning.size().stale).toBe(0);
    // saved again, it takes back the text of the save before
    await learning.saved(key, story);
    expect(learning.predict("The light was ")).toBeUndefined();
    expect(learning.predict("a post about my web")).toBe("site and how it");
    learning.stop();
});

test("a document from a place not learned from is not learned when saved", async () => {
    const { store } = await shelf([]);
    const other = await shelf([]);
    const learning = learner(() => [store]);
    await learning.start();
    await learning.saved(documentKey(other.store, "x.md"), story);
    expect(learning.predict("a post about my web")).toBeUndefined();
    learning.stop();
});

test("a document changed elsewhere is not counted twice: it is out of date until enough are, and then everything is learned again", async () => {
    const time = { now: 1000 };
    const texts = Array.from({ length: 12 }, (_, index) => (index === 0 ? story : `Note number ${index}.`));
    const { store, ids } = await shelf(texts, time);
    const keeper = memoryKeeper();
    const first = learner(() => [store], keeper);
    await first.start();
    await new Promise((done) => setTimeout(done, 10));
    await first.settled();
    first.stop();
    // the story changes elsewhere: the same phrase, now written once more
    time.now = 2000;
    const opened = await store.open(ids[0]!);
    await store.save(ids[0]!, story + story, opened.mark);
    const second = learner(() => [store], keeper);
    await second.start();
    expect(second.size().stale).toBe(1);
    // what it learned before stands, and is not added to
    expect(second.size().tokens).toBe(first.size().tokens);
    second.stop();
    // eleven more changed elsewhere is more than a tenth: everything is learned again
    time.now = 3000;
    for (const id of ids.slice(1)) {
        const was = await store.open(id);
        await store.save(id, `${was.text} Changed.`, was.mark);
    }
    const third = learner(() => [store], keeper);
    await third.start();
    expect(third.size().stale).toBe(0);
    expect(third.size().documents).toBe(12);
    expect(third.predict("a post about my web")).toBe("site and how it");
    third.stop();
});

test("forgetting empties it, and documents not written in since are not learned again", async () => {
    const time = { now: 1000 };
    const { store, ids } = await shelf([story], time);
    const keeper = memoryKeeper();
    let clock = 5000;
    const learning = learner(() => [store], keeper, () => clock);
    await learning.start();
    await learning.forget();
    expect(learning.predict("a post about my web")).toBeUndefined();
    await new Promise((done) => setTimeout(done, 10));
    await learning.settled();
    learning.stop();
    const again = learner(() => [store], keeper, () => clock);
    await again.start();
    expect(again.size().documents).toBe(0);
    await new Promise((done) => setTimeout(done, 10));
    await again.settled();
    again.stop();
    // a document written in after forgetting is learned
    time.now = clock = 6000;
    const was = await store.open(ids[0]!);
    await store.save(ids[0]!, `${was.text} More.`, was.mark);
    const later = learner(() => [store], keeper, () => clock);
    await later.start();
    expect(later.size().documents).toBe(1);
    later.stop();
});

test("anything broken that was kept is passed over, and the shelf is learned afresh", async () => {
    const { store } = await shelf([story]);
    for (const broken of [{ docs: "no" }, { model: {}, docs: [["k", { hash: 1 }]], since: 0, stale: 0 }, "text", 7]) {
        const keeper: Keeper = { load: async () => broken, save: async () => {}, clear: async () => {} };
        const learning = learner(() => [store], keeper);
        await learning.start();
        expect(learning.predict("a post about my web")).toBe("site and how it");
        learning.stop();
    }
});

test("the hash of a text tells a changed text from the same one", () => {
    expect(hashOf("abc")).toBe(hashOf("abc"));
    expect(hashOf("abc")).not.toBe(hashOf("abd"));
    expect(hashOf("")).toBe("811c9dc5:0");
});
