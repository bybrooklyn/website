// A session from sound to text, with a made-up recognizer and made-up sound: provisional words
// while speaking, settled text at a pause as one undo step, stopping itself after quiet, the spoken
// commands, a window cut at its quietest moment, and falling back to pause-only when too slow.

import { describe, expect, test } from "bun:test";
import { documentOf, insertText, paragraph, textAt, type Document, type Selection } from "../document";
import type { ChangeKind, State } from "../history";
import { caret } from "../keys";
import { write as markdown } from "../write";
import { startSession, type Live, type LiveUpdate, type Reason, type Recognizer, type Session, type Target } from "./session";
import { nothing, type Custom } from "./words";

const RATE = 16000;

/** What the made-up recognizer says: one phrase per loudness, a word for each half second of sound that is loud. */
const PHRASES: Record<string, string> = { "20": "hello there my dear friend period", "30": "undo that", "40": "delete that", "50": "stop dictation", "60": "second phrase here" };

function recognizer(ms = 50): Recognizer & { calls: number } {
    const made = {
        calls: 0,
        backend: "fake",
        dispose() {},
        async transcribe(samples: Float32Array) {
            made.calls++;
            let loud = 0;
            let top = 0;
            for (const value of samples) if (Math.abs(value) > 0.05) loud++;
            for (const value of samples) top = Math.max(top, Math.abs(value));
            const words = (PHRASES[String(Math.round(top * 100))] ?? "").split(" ").filter(Boolean);
            const shown = Math.min(words.length, Math.floor(loud / (RATE / 2 / 1.4)));
            return { text: words.slice(0, shown).join(" "), ms };
        },
    };
    return made;
}

/** An editor's surface reduced to what a session uses, with an undo stack. */
function target(): Target & { text(): string; steps: number } {
    let state: State = { doc: documentOf([paragraph()]), selection: caret([0], 0) };
    const done: State[] = [];
    const made = {
        steps: 0,
        getDocument: () => state.doc,
        getSelection: (): Selection => state.selection,
        run(operation: (doc: Document, selection: Selection) => State, _kind?: ChangeKind) {
            const next = operation(state.doc, state.selection);
            if (next.doc !== state.doc) {
                done.push(state);
                made.steps++;
            }
            state = next;
        },
        undo() {
            const back = done.pop();
            if (back) state = back;
        },
        text: () => markdown(state.doc).trim(),
    };
    return made;
}

/** `ms` of a 220 Hz tone, or of quiet, in frames of a tenth of a second. */
function frames(ms: number, amplitude: number): Float32Array[] {
    const out: Float32Array[] = [];
    for (let at = 0; at < ms; at += 100) {
        const frame = new Float32Array(1600);
        let seed = at + 3;
        for (let i = 0; i < 1600; i++) {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            frame[i] = amplitude > 0.01 ? amplitude * Math.sin((2 * Math.PI * 220 * (at / 1000 * RATE + i)) / RATE) : amplitude * (seed / 4294967296 - 0.5) * 2;
        }
        out.push(frame);
    }
    return out;
}
const quiet = (ms: number) => frames(ms, 0.001);

/** Runs a session over frames, letting the recognizer's promises settle between them. */
async function drive(session: Session, all: Float32Array[]) {
    for (const frame of all) {
        session.feed(frame);
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
}

function make(extra: { ms?: number; custom?: Custom; commands?: boolean } = {}) {
    const editor = target();
    const heard = recognizer(extra.ms);
    const shown: string[] = [];
    const stops: Reason[] = [];
    const notes: string[] = [];
    const session = startSession({
        target: editor,
        recognizer: heard,
        commands: () => extra.commands ?? true,
        custom: () => extra.custom ?? nothing(),
        onProvisional: (text) => shown.push(text),
        onStop: (reason) => stops.push(reason),
        onNote: (note) => notes.push(note),
    });
    return { editor, heard, shown, stops, notes, session };
}

describe("speaking", () => {
    test("shows provisional words while speaking, and none in the document", async () => {
        const { editor, shown, session } = make();
        await drive(session, [...quiet(500), ...frames(2400, 0.2)]);
        expect(shown.filter(Boolean).length).toBeGreaterThan(0);
        expect(shown.at(-1)).toMatch(/^Hello there|hello there/i);
        expect(editor.text()).toBe("");
        expect(editor.steps).toBe(0);
    });
    test("settles the phrase at a pause as one undoable step, and the provisional words go", async () => {
        const { editor, shown, session } = make();
        await drive(session, [...quiet(500), ...frames(2900, 0.2), ...quiet(1200)]);
        expect(editor.text()).toBe("Hello there my dear friend.");
        expect(editor.steps).toBe(1);
        expect(shown.at(-1)).toBe("");
        editor.undo();
        expect(editor.text()).toBe("");
    });
    test("each phrase is its own step, written after the one before", async () => {
        const { editor, session } = make();
        await drive(session, [...quiet(300), ...frames(2900, 0.2), ...quiet(1000), ...frames(2000, 0.6), ...quiet(1000)]);
        expect(editor.text()).toBe("Hello there my dear friend. Second phrase here");
        expect(editor.steps).toBe(2);
    });
    test("applies the visitor's custom words to what is written", async () => {
        const { editor, session } = make({ custom: { words: [{ word: "Dearest", sounds: ["dear"] }], shortcuts: [] } });
        await drive(session, [...quiet(300), ...frames(2900, 0.2), ...quiet(1000)]);
        expect(editor.text()).toBe("Hello there my Dearest friend.");
    });
});

describe("stopping", () => {
    test("by itself after quiet that follows speech, having written the phrase", async () => {
        const { editor, stops, session } = make();
        await drive(session, [...quiet(300), ...frames(2900, 0.2), ...quiet(3500)]);
        expect(stops).toEqual(["silence"]);
        expect(editor.text()).toBe("Hello there my dear friend.");
    });
    test("by itself when nothing is said for a long time", async () => {
        const { stops, session } = make();
        await drive(session, quiet(9000));
        expect(stops).toEqual(["nothing"]);
    });
    test("when asked, settling the phrase still being said", async () => {
        const { editor, stops, session } = make();
        await drive(session, [...quiet(300), ...frames(2900, 0.2)]);
        await session.stop("button");
        expect(editor.text()).toBe("Hello there my dear friend.");
        expect(stops).toEqual(["button"]);
    });
    test("when the visitor says stop dictation, once", async () => {
        const { stops, session } = make();
        await drive(session, [...quiet(300), ...frames(2000, 0.5), ...quiet(1200), ...quiet(300)]);
        expect(stops).toEqual(["command"]);
    });
    test("takes no more sound after it has stopped", async () => {
        const { editor, session } = make();
        await session.stop("button");
        await drive(session, [...quiet(300), ...frames(2900, 0.2), ...quiet(1000)]);
        expect(editor.text()).toBe("");
    });
});

describe("spoken commands", () => {
    test("undo that takes back the last phrase", async () => {
        const { editor, session } = make();
        await drive(session, [...quiet(300), ...frames(2900, 0.2), ...quiet(1000), ...frames(1500, 0.3), ...quiet(1000)]);
        expect(editor.text()).toBe("");
    });
    test("delete that removes the last phrase", async () => {
        const { editor, session } = make();
        await drive(session, [...quiet(300), ...frames(2900, 0.2), ...quiet(1000), ...frames(1500, 0.4), ...quiet(1000)]);
        expect(editor.text()).toBe("");
    });
    /** An editor holding a line the writer typed herself, as its own undo step. */
    function typed() {
        const editor = target();
        editor.run((doc) => ({ doc: insertText(doc, { path: [0], offset: 0 }, "Mine. "), selection: caret([0], 6) }), "type");
        return editor;
    }
    function on(editor: Target) {
        return startSession({ target: editor, recognizer: recognizer(), commands: () => true, custom: () => nothing() });
    }
    test("undo that, said before anything was dictated, leaves the writer's own work alone", async () => {
        const editor = typed();
        await drive(on(editor), [...quiet(300), ...frames(1500, 0.3), ...quiet(1000), ...frames(1500, 0.3), ...quiet(1000)]);
        expect(editor.text()).toBe("Mine.");
    });
    test("undo that, said again and again, takes back only the one phrase dictated", async () => {
        const editor = typed();
        await drive(on(editor), [...quiet(300), ...frames(2900, 0.2), ...quiet(1000), ...frames(1500, 0.3), ...quiet(1000), ...frames(1500, 0.3), ...quiet(1000), ...frames(1500, 0.3), ...quiet(1000)]);
        expect(editor.text()).toBe("Mine.");
        editor.undo();
        expect(editor.text()).toBe("");
    });
    test("undo that does nothing once the writer has changed the document since the phrase", async () => {
        const editor = typed();
        const session = on(editor);
        await drive(session, [...quiet(300), ...frames(2900, 0.2), ...quiet(1000)]);
        editor.run((doc, selection) => ({ doc: insertText(doc, selection.focus, " Also mine."), selection: caret([0], selection.focus.offset + 11) }), "type");
        await drive(session, [...frames(1500, 0.3), ...quiet(1000)]);
        expect(editor.text()).toBe("Mine. Hello there my dear friend. Also mine.");
    });
    test("delete that, said again and again, takes back only the one phrase dictated, as one undo step", async () => {
        const editor = typed();
        await drive(on(editor), [...quiet(300), ...frames(2900, 0.2), ...quiet(1000), ...frames(1500, 0.4), ...quiet(1000), ...frames(1500, 0.4), ...quiet(1000)]);
        expect(editor.text()).toBe("Mine.");
    });
    test("a phrase that could not be written (the cursor where text cannot go) is not taken back by delete that, so the writer's work stays", async () => {
        const editor = typed();
        const run = editor.run;
        // the editor writes nothing for a dictated phrase, as in a block that takes no text
        editor.run = (operation, kind) => (kind === "paste" ? void operation(editor.getDocument(), editor.getSelection()) : run(operation, kind));
        await drive(on(editor), [...quiet(300), ...frames(2900, 0.2), ...quiet(1000), ...frames(1500, 0.4), ...quiet(1000)]);
        expect(editor.text()).toBe("Mine.");
    });
    test("with commands off every word is written", async () => {
        const { editor, session } = make({ commands: false });
        await drive(session, [...quiet(300), ...frames(2900, 0.2), ...quiet(1000)]);
        expect(editor.text()).toBe("Hello there my dear friend period");
    });
});

describe("keeping up", () => {
    test("a recognizer that is too slow turns provisional words off, and says so", async () => {
        const { editor, notes, session } = make({ ms: 4000 });
        await drive(session, [...quiet(300), ...frames(5000, 0.2), ...quiet(1000)]);
        expect(session.mode()).toBe("pause");
        expect(notes.join(" ")).toContain("cannot keep up");
        expect(editor.text()).toBe("Hello there my dear friend.");
    });
    test("a quick one keeps them", async () => {
        const { session } = make({ ms: 30 });
        await drive(session, [...quiet(300), ...frames(4000, 0.2)]);
        expect(session.mode()).toBe("live");
    });
});

describe("a long unbroken stretch", () => {
    test("is cut at its quietest moment and the first part settled before the pause", async () => {
        const { editor, heard, session } = make();
        const dip = [...frames(6000, 0.2), ...frames(300, 0.001), ...frames(6000, 0.2)];
        await drive(session, dip);
        expect(heard.calls).toBeGreaterThan(1);
        expect(editor.steps).toBeGreaterThanOrEqual(1);
        expect(textAt(editor.getDocument(), [0]).length).toBeGreaterThan(0);
    });
});

/** A recognizer with a live stream: each second of sound given is a word, and `behind` is what the test says it is. */
function streaming(behind = 0, finishing = 0) {
    const made = {
        backend: "fake",
        dispose() {},
        calls: 0,
        async transcribe(_samples: Float32Array) {
            made.calls++;
            return { text: "hello there", ms: 10 };
        },
        opened: 0,
        /** Samples in the first piece of sound each stream was given. */
        first: [] as number[],
        cancelled: 0,
        boost(_words: string[]) {},
        stream(): Live {
            made.opened++;
            let listener: (update: LiveUpdate) => void = () => {};
            let heard = 0;
            let pieces = 0;
            const words = ["hello", "there", "my", "dear", "friend"];
            const said = () => words.slice(0, Math.min(words.length, Math.floor(heard / RATE))).map((text, at) => ({ text, start: at, end: at + 1 }));
            return {
                push(samples) {
                    if (pieces++ === 0) made.first.push(samples.length);
                    heard += samples.length;
                    listener({ words: said(), tentative: [], ms: 100, seconds: 1, behind });
                },
                onUpdate: (next) => void (listener = next),
                finish: async () => {
                    await new Promise((done) => setTimeout(done, finishing));
                    return said();
                },
                cancel: () => void made.cancelled++,
            };
        },
    };
    return made;
}

describe("a recognizer with a live stream", () => {
    function setup(heard: ReturnType<typeof streaming>) {
        const editor = target();
        const shown: string[] = [];
        const notes: string[] = [];
        const session = startSession({ target: editor, recognizer: heard, commands: () => true, custom: () => nothing(), onProvisional: (text) => shown.push(text), onNote: (note) => notes.push(note) });
        return { editor, shown, notes, session, heard };
    }
    test("shows the stream's words while speaking and writes the finished phrase at the pause without asking the recognizer again", async () => {
        const { editor, shown, session, heard } = setup(streaming());
        await drive(session, [...quiet(500), ...frames(3000, 0.2), ...quiet(1200)]);
        expect(shown.some((text) => /hello there/i.test(text))).toBe(true);
        expect(editor.text().startsWith("Hello there")).toBe(true);
        expect(editor.steps).toBe(1);
        expect(heard.opened).toBe(1);
        expect(heard.calls).toBe(0);
    });
    test("a phrase that begins while the one before is still being finished does not carry the sound of the one before", async () => {
        const { editor, session, heard } = setup(streaming(0, 200));
        await drive(session, [...quiet(300), ...frames(2000, 0.2), ...quiet(700), ...frames(2000, 0.2), ...quiet(1200)]);
        await new Promise((done) => setTimeout(done, 700));
        expect(heard.opened).toBe(2);
        // a second and a half at the most: the pre-roll, not the whole of what was in the buffer
        expect(heard.first[1]!).toBeLessThanOrEqual(1.6 * RATE);
        expect(editor.text().split(/\s+/).filter((word) => /hello/i.test(word)).length).toBe(2);
    });
    test("falls back to writing at the pause when the stream is far behind, and says so", async () => {
        const { editor, notes, session, heard } = setup(streaming(9));
        await drive(session, [...quiet(300), ...frames(3000, 0.2), ...quiet(1200)]);
        expect(session.mode()).toBe("pause");
        expect(heard.cancelled).toBe(1);
        expect(notes.join(" ")).toContain("cannot keep up");
        // the phrase is still written, by asking the recognizer about the whole of it
        expect(heard.calls).toBeGreaterThan(0);
        expect(editor.text().length).toBeGreaterThan(0);
    });
});

describe("the microphone", () => {
    /** A recognizer whose answers wait until the test lets them go. */
    function held() {
        const waiting: (() => void)[] = [];
        const made = {
            backend: "fake",
            dispose() {},
            transcribe: (samples: Float32Array) => new Promise<{ text: string; ms: number }>((done) => waiting.push(() => recognizer().transcribe(samples).then(done))),
            release: () => waiting.splice(0).forEach((go) => go()),
        };
        return made;
    }
    test("is let go the moment stop is pressed, while the last phrase is still being recognized", async () => {
        const heard = held();
        const events: string[] = [];
        const session = startSession({ target: target(), recognizer: heard, commands: () => true, custom: () => nothing(), onRelease: () => events.push("release"), onStop: () => events.push("stop") });
        await drive(session, [...quiet(300), ...frames(2900, 0.2)]);
        const stopped = session.stop("button");
        expect(events).toEqual(["release"]);
        heard.release();
        await new Promise((done) => setTimeout(done, 0));
        heard.release();
        await stopped;
        expect(events).toEqual(["release", "stop"]);
    });
    test("is let go when the session stops itself after quiet, before the phrase is written", async () => {
        const heard = held();
        const events: string[] = [];
        const session = startSession({ target: target(), recognizer: heard, commands: () => true, custom: () => nothing(), onRelease: () => events.push("release"), onStop: () => events.push("stop") });
        await drive(session, [...quiet(300), ...frames(2900, 0.2), ...quiet(3500)]);
        expect(events).toEqual(["release"]);
        heard.release();
        await new Promise((done) => setTimeout(done, 10));
        heard.release();
        await session.stop("button");
        expect(events).toEqual(["release", "stop"]);
    });
});

describe("every way out of a session", () => {
    /** Ways a session can end, each from the middle of a phrase, with the recognizer and editor it needs. */
    const ways: [string, (session: Session) => void | Promise<void>, { failing?: "transcribe" | "finish" | "write"; live?: boolean }][] = [
        ["the button", (session) => void session.stop("button"), {}],
        ["a page that is hidden or left", (session) => void session.stop("hidden"), {}],
        ["a microphone taken away", (session) => void session.stop("lost"), {}],
        ["quiet after speech", () => {}, {}],
        ["an error in recognizing", () => {}, { failing: "transcribe" }],
        ["an error while writing into the document", () => {}, { failing: "write" }],
        ["the worker dying under a live phrase", () => {}, { failing: "finish", live: true }],
    ];
    for (const [what, end, how] of ways) {
        test(`${what}: the microphone is let go once, stop resolves, and onStop is called once`, async () => {
            const editor = target();
            if (how.failing === "write")
                editor.run = () => {
                    throw new Error("boom");
                };
            const base = how.live ? streaming() : recognizer();
            const dead = () => Promise.reject(new Error("The speech engine stopped"));
            const heard: Recognizer = {
                ...base,
                transcribe: how.failing === "transcribe" || how.failing === "finish" ? dead : base.transcribe,
                ...(how.live ? { stream: () => ({ ...(base as ReturnType<typeof streaming>).stream(), finish: dead }) } : {}),
            };
            const released: number[] = [];
            const stops: Reason[] = [];
            const session = startSession({ target: editor, recognizer: heard, commands: () => true, custom: () => nothing(), onRelease: () => released.push(1), onStop: (reason) => stops.push(reason) });
            await drive(session, [...quiet(300), ...frames(2900, 0.2)]);
            await end(session);
            await drive(session, [...quiet(3500)]);
            await session.stop("button");
            await session.stop("button");
            expect(released.length).toBe(1);
            expect(stops.length).toBe(1);
            if (how.failing) expect(stops[0]).toBe("error");
        });
    }
});

describe("a throw while a phrase is settled", () => {
    test("in the editor's writing ends the session: stop resolves and onStop is called once", async () => {
        const editor = target();
        editor.run = () => {
            throw new Error("boom");
        };
        const stops: Reason[] = [];
        const notes: string[] = [];
        const session = startSession({ target: editor, recognizer: recognizer(), commands: () => true, custom: () => nothing(), onStop: (reason) => stops.push(reason), onNote: (note) => notes.push(note) });
        await drive(session, [...quiet(300), ...frames(2900, 0.2)]);
        await session.stop("button");
        expect(stops).toEqual(["error"]);
        expect(notes.join(" ")).toContain("boom");
        await session.stop("button");
        expect(stops.length).toBe(1);
    });
    test("at a pause ends the session at once, without waiting for the button", async () => {
        const editor = target();
        editor.run = () => {
            throw new Error("boom");
        };
        const stops: Reason[] = [];
        const session = startSession({ target: editor, recognizer: recognizer(), commands: () => true, custom: () => nothing(), onStop: (reason) => stops.push(reason) });
        await drive(session, [...quiet(300), ...frames(2900, 0.2), ...quiet(1000)]);
        expect(stops).toEqual(["error"]);
    });
});
