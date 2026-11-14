// One run of dictation, from sound to text. It is given the 16 kHz sound as it arrives, in frames,
// and a recognizer; it keeps the sound of the phrase being spoken as a window, asks the recognizer
// again as more of it arrives and shows the answer as provisional words, and when the phrase is
// settled (a pause, or the window grown too long) writes the final answer into the document as one
// undoable step.
//
// Everything here counts time in samples, so it behaves the same fast or slow, and the tests feed
// it a minute of sound in a moment. It knows the editor only through `Target`, which is the part of
// the surface it uses.
//
//   const session = startSession({ target: surface, recognizer, commands: () => true, custom: () => words, ... });
//   session.feed(frame);            // each frame the microphone gives
//   await session.stop("button");   // settles what is left

import type { Document, Selection } from "../document";
import { textAt } from "../document";
import type { State } from "../history";
import type { ChangeKind } from "../history";
import { textBefore, write, type Pending } from "./insert";
import { spread, type Word } from "./merge";
import { interpret } from "./spoken";
import { createVoice } from "./voice";
import { correct, type Custom } from "./words";

/** What a recognizer gives back for a stretch of sound. `words` carry times from the start of that sound when the model gives them. */
export interface Recognized {
    text: string;
    words?: Word[];
    /** Milliseconds the recognizing took. */
    ms: number;
}

/** What a live stream tells the session each time it has looked at more sound. */
export interface LiveUpdate {
    /** Words settled so far in the phrase. */
    words: Word[];
    /** The words after them as they stand, which may change. */
    tentative: Word[];
    /** Milliseconds of work and seconds of new sound the step covered. */
    ms: number;
    seconds: number;
    /** Seconds of sound that have arrived and are not in this update yet. */
    behind: number;
}

/** A phrase recognized as it is spoken, by a recognizer that can keep its place between pieces of sound. */
export interface Live {
    /** Gives the next piece of sound; the answer comes through `onUpdate`. */
    push(samples: Float32Array): void;
    onUpdate(listener: (update: LiveUpdate) => void): void;
    /** Ends the phrase and gives all its words. */
    finish(): Promise<Word[]>;
    /** Ends the phrase and forgets it. */
    cancel(): void;
}

/** Anything that turns sound into text. */
export interface Recognizer {
    transcribe(samples: Float32Array): Promise<Recognized>;
    /** Starts a live phrase, if the recognizer can. Without it, provisional words come from asking again over a window of the sound. */
    stream?(): Live;
    /** The visitor's words to lean toward, if the recognizer can. */
    boost?(words: string[]): void;
    /** Which kind of computing it runs on, for the panel. */
    backend: string;
    dispose(): void;
}

/** The part of the editor's surface a session uses. */
export interface Target {
    getDocument(): Document;
    getSelection(): Selection;
    run(operation: (doc: Document, selection: Selection) => State, kind?: ChangeKind): void;
    undo(): void;
}

/** Why a session ended: "hidden" when the page was hidden or left, "lost" when the microphone was taken away. */
export type Reason = "button" | "silence" | "nothing" | "command" | "error" | "hidden" | "lost";

/** What a session is given. */
export interface SessionOptions {
    target: Target;
    recognizer: Recognizer;
    /** Whether spoken punctuation and commands are on, asked each time since it can be switched during a session. */
    commands: () => boolean;
    custom: () => Custom;
    onLevel?: (level: number, speaking: boolean) => void;
    /** The provisional words, or "" when there are none. */
    onProvisional?: (text: string) => void;
    /** A line for the panel: how it is keeping up. */
    onNote?: (note: string) => void;
    /** Called once, the moment the session stops taking sound and before the last phrase is settled from what was already heard: the microphone is closed here. */
    onRelease?: () => void;
    onStop?: (reason: Reason) => void;
    /** Quiet times in milliseconds, for tests. */
    silence?: number;
    wait?: number;
}

/** A running session. */
export interface Session {
    feed(frame: Float32Array): void;
    stop(reason: Reason): Promise<void>;
    /** "live" shows provisional words; "pause" only recognizes at each pause, because the machine cannot keep up. */
    mode(): "live" | "pause";
    /** Recognizing time over sound time, smoothed. */
    speed(): number;
}

const RATE = 16000;
/** The longest window asked about, in seconds; past it the window is cut at its quietest moment. */
export const WINDOW = 10;
/** Provisional words need the machine to recognize faster than this many seconds per second of sound. */
export const LIVE_LIMIT = 0.45;
/** A live stream whose newest words are more than this many seconds old when they are shown (sound waiting plus the step), twice running, cannot keep up. */
export const BEHIND_LIMIT = 5;
/** The longest a live phrase runs without a pause before it is ended, in seconds. */
const LONGEST = 3 * WINDOW;
/** Sound kept before speech starts, so that the first word is not clipped, in seconds. */
const PRE_ROLL = 0.8;

/** Starts a session on a target. */
export function startSession(options: SessionOptions): Session {
    const { target, recognizer } = options;
    const voice = createVoice({ silence: options.silence, wait: options.wait });

    let buffer = new Float32Array(RATE * (WINDOW + 4));
    let length = 0;
    /** Samples before the start of the buffer, in all the sound heard. */
    let origin = 0;
    let active = false;
    let queue: Promise<void> = Promise.resolve();
    let waiting = false;
    let generation = 0;
    let lastRun = 0;
    let busy = false;
    let speed = 0;
    let measured = 0;
    let mode: "live" | "pause" = "live";
    let stopping = false;
    let finished = false;
    /** The session's end, once it has begun, and whether something went wrong on the way. */
    let ending: Promise<void> | undefined;
    let failed = false;
    let pending: Pending = {};
    let last: { text: string; after: Document } | undefined;
    let shown = "";
    /** The live stream of the phrase being spoken, when the recognizer has one and the machine keeps up. */
    let live: Live | undefined;
    let late = 0;
    /** Samples given to the stream since it last answered. */
    let unanswered = 0;

    const show = (text: string) => {
        if (text !== shown) options.onProvisional?.((shown = text));
    };
    const append = (frame: Float32Array) => {
        if (length + frame.length > buffer.length) {
            const bigger = new Float32Array(Math.max(buffer.length * 2, length + frame.length));
            bigger.set(buffer.subarray(0, length));
            buffer = bigger;
        }
        buffer.set(frame, length);
        length += frame.length;
    };
    const drop = (count: number) => {
        buffer.copyWithin(0, count, length);
        length -= count;
        origin += count;
    };

    /** The point in the buffer, between one and four seconds from its end, where the sound is quietest. */
    const quietest = (): number => {
        const block = 1600;
        let at = length - 4 * RATE;
        let low = Infinity;
        let best = length - RATE;
        for (at = Math.max(RATE, at); at + block <= length - RATE; at += block) {
            let sum = 0;
            for (let i = at; i < at + block; i++) sum += buffer[i]! * buffer[i]!;
            if (sum < low) {
                low = sum;
                best = at + block / 2;
            }
        }
        return best;
    };

    const note = (text: string) => options.onNote?.(text);

    /** Asks the recognizer about the first `count` samples of the buffer. */
    async function recognize(count: number): Promise<{ text: string; words: Word[] } | undefined> {
        const samples = buffer.slice(0, count);
        const from = origin / RATE;
        try {
            const heard = await recognizer.transcribe(samples);
            const seconds = count / RATE;
            // how quickly the machine recognizes decides whether provisional words are kept up
            if (seconds >= 1.2) {
                const rate = heard.ms / 1000 / seconds;
                speed = measured === 0 ? rate : speed * 0.6 + rate * 0.4;
                measured++;
                if (mode === "live" && !recognizer.stream && measured >= 2 && speed > LIVE_LIMIT) {
                    mode = "pause";
                    show("");
                    note("This machine cannot keep up with live words, so dictation writes each phrase when you pause.");
                }
            }
            const words = (heard.words && heard.words.length > 0 ? heard.words : spread(heard.text, 0, seconds)).map((word) => ({ ...word, start: word.start + from, end: word.end + from }));
            return { text: heard.text, words };
        } catch (error) {
            fail(error);
            return undefined;
        }
    }

    /** The words would come too late to be of use: this machine writes at the pause instead. */
    function giveUp(why: string) {
        live?.cancel();
        live = undefined;
        mode = "pause";
        show("");
        note(`This machine cannot keep up with live words (${why}), so dictation writes each phrase when you pause.`);
    }

    /** Opens a live stream for the phrase that has just begun, starting it with the sound kept from before the speech. */
    function openLive(preRoll = true) {
        if (!recognizer.stream || mode !== "live") return;
        const stream = recognizer.stream();
        live = stream;
        late = 0;
        unanswered = 0;
        stream.onUpdate((update) => {
            if (live !== stream || finished) return;
            unanswered = 0;
            const rate = update.ms / 1000 / Math.max(0.001, update.seconds);
            speed = measured === 0 ? rate : speed * 0.6 + rate * 0.4;
            measured++;
            late = update.behind + update.ms / 1000 > BEHIND_LIMIT ? late + 1 : 0;
            if (late >= 2) return giveUp(`they were ${(update.behind + update.ms / 1000).toFixed(0)} seconds late`);
            show(correct([...update.words, ...update.tentative].map((word) => word.text).join(" "), options.custom()));
        });
        // Only the last stretch before the speech is the new phrase's. The buffer can still hold the end
        // of the one before, while that one is being finished, and giving it again would write it twice.
        if (preRoll) stream.push(buffer.slice(Math.max(0, length - Math.round((PRE_ROLL + 0.4) * RATE)), length));
    }

    /** Writes settled text at the cursor as one undoable step and carries out the commands in it. */
    function settle(text: string) {
        const fixed = correct(text, options.custom());
        if (!fixed.trim()) return;
        const state = { doc: target.getDocument(), selection: target.getSelection() };
        const steps = interpret(fixed, { before: textBefore(state, (path) => textAt(state.doc, path)), commands: options.commands() });
        let commands: ReturnType<typeof write>["commands"] = [];
        const unchanged = state.doc;
        target.run((doc, selection) => {
            const done = write({ doc, selection }, steps, pending);
            pending = done.pending;
            commands = done.commands;
            return done.state;
        }, "paste");
        // Only a phrase that changed the document is one to take back. One that wrote nothing (the cursor in a block
        // that takes no text) must not be, or "delete that" would undo the step before it, which is the writer's.
        if (target.getDocument() !== unchanged) last = { text: fixed, after: target.getDocument() };
        for (const command of commands) {
            if (command === "undo") undoLast();
            else if (command === "delete") deleteLast();
            else if (command === "stop") void finish("command");
        }
    }

    /**
     * "undo that" is heard from sound alone, which a video or another voice in the room can make, so
     * it is bounded: it takes back only the last phrase this session wrote, and only while the
     * document is still exactly as that phrase left it. Then the phrase is forgotten, so saying it
     * again does nothing until another phrase is written. It never reaches the writer's own work.
     */
    function undoLast() {
        if (last && target.getDocument() === last.after) target.undo();
        last = undefined;
    }

    /** Takes back the last phrase dictated: by undo if nothing else has been done since, or by taking its text from before the cursor. Bounded as `undoLast` is: once, and only this session's last phrase. */
    function deleteLast() {
        if (!last) return;
        if (target.getDocument() === last.after) target.undo();
        else {
            const wanted = last.text.trim();
            target.run((doc, selection) => {
                const at = selection.focus;
                const before = textAt(doc, at.path).slice(0, at.offset);
                const cut = before.trimEnd().endsWith(wanted) ? before.trimEnd().length - wanted.length : -1;
                if (cut < 0) return { doc, selection };
                // the text is taken out through the same step as writing, by an erase of nothing and a replacement
                const state = write({ doc, selection: { anchor: { path: at.path, offset: at.offset }, focus: { path: at.path, offset: at.offset } } }, [{ kind: "text", text: "", erase: at.offset - cut }]);
                return state.state;
                // a step of its own kind, so that it never joins a Backspace typed just before and one undo puts it back
            }, "replace");
        }
        last = undefined;
    }

    /** Settles the first `count` samples: asks, writes what is said, and drops that sound from the window. */
    function settleFirst(count: number): Promise<void> {
        generation++;
        // The phrase's live stream is taken out of the session now, not when the job runs: the next phrase may begin first and make a stream of its own.
        const stream = live;
        live = undefined;
        const job = queue.then(async () => {
            busy = true;
            try {
                // a live phrase already holds everything said, so it is only asked to finish
                let said: string | undefined;
                if (stream) {
                    said = await stream.finish().then((words) => words.map((word) => word.text).join(" "), () => undefined);
                }
                const heard = said === undefined && count >= 1600 ? await recognize(count) : undefined;
                if (said?.trim()) settle(said);
                if (heard) {
                    if (heard.words.length > 0) settle(heard.words.map((word) => word.text).join(" "));
                }
                drop(Math.min(count, length));
                lastRun = 0;
                if (count >= length) show("");
            } catch (error) {
                // the phrase could not be written: the session ends here, as it does when recognizing fails
                fail(error);
            } finally {
                busy = false;
            }
        });
        queue = job;
        return job;
    }

    /** Asks about the whole window for provisional words. */
    function provisional() {
        if (waiting || busy || finished || mode !== "live" || !active) return;
        const count = length;
        const mine = generation;
        waiting = true;
        queue = queue.then(async () => {
            waiting = false;
            if (mine !== generation || finished) return;
            busy = true;
            try {
                const heard = await recognize(count);
                if (!heard || mine !== generation || finished) return;
                lastRun = count;
                show(correct(heard.words.map((word) => word.text).join(" "), options.custom()));
            } catch (error) {
                fail(error);
            } finally {
                busy = false;
            }
        });
    }

    /** Something went wrong in recognizing or writing: it is said, and the session ends. */
    function fail(error: unknown) {
        failed = true;
        note(`Dictation stopped: ${error instanceof Error ? error.message : String(error)}`);
        void finish("error");
    }

    /**
     * Ends the session, once: whatever asks again is given the same promise. Every way out comes
     * here, and whatever happens while the last phrase is settled, the promise resolves and
     * `onStop` is called exactly once.
     */
    function finish(reason: Reason): Promise<void> {
        if (ending) return ending;
        stopping = true;
        // no more sound is taken from here, so the microphone goes at once and only the work on what was heard goes on
        try {
            options.onRelease?.();
        } catch (error) {
            failed = true;
            note(`Dictation stopped: ${error instanceof Error ? error.message : String(error)}`);
        }
        ending = (async () => {
            try {
                if (active && length >= 3200) await settleFirst(length);
                else await queue;
            } catch (error) {
                failed = true;
                note(`Dictation stopped: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                finished = true;
                live?.cancel();
                live = undefined;
                show("");
                options.onLevel?.(0, false);
                options.onStop?.(failed ? "error" : reason);
            }
        })();
        return ending;
    }

    return {
        mode: () => mode,
        speed: () => speed,
        stop: finish,
        feed(frame) {
            if (finished || stopping) return;
            append(frame);
            const heard = voice.feed(frame);
            options.onLevel?.(heard.level, heard.speaking);
            if (heard.event === "start") {
                active = true;
                openLive();
            } else if (live) {
                live.push(frame.slice());
                unanswered += frame.length;
                if (unanswered > 2 * BEHIND_LIMIT * RATE) giveUp("no word has come for 10 seconds");
            }
            // before anyone speaks only a little sound is kept
            if (!active && !busy && length > PRE_ROLL * RATE) drop(length - Math.round(PRE_ROLL * RATE));
            if (heard.event === "pause" && active) {
                active = false;
                void settleFirst(length);
            } else if (heard.event === "silence" || heard.event === "nothing") {
                void finish(heard.event === "silence" ? "silence" : "nothing");
            } else if (active && live && length > LONGEST * RATE && !busy) {
                // Sound that never pauses (a television, a fan above the threshold) would keep one live phrase open, and
                // all its sound, for as long as it lasts. At three windows the phrase is ended and the next goes on in a
                // new stream, given none of the old sound, which the old one already holds.
                void settleFirst(length);
                openLive(false);
            } else if (active && length > WINDOW * RATE && !busy && !waiting && !live) {
                // the window has grown too long: the first part is settled at its quietest moment
                void settleFirst(quietest());
            } else if (active && mode === "live" && !recognizer.stream && length - lastRun >= Math.max(0.8, Math.min(2.5, speed * 1.6)) * RATE) provisional();
        },
    };
}
