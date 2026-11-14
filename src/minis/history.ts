// Undo and redo for the marble run: every state of the run, as its text (run.ts), from the first to the
// last, and which of them is shown. A run's text is about 12 characters a piece, so keeping each whole
// state is simpler than keeping changes and costs little: a run of twenty pieces is under 300 characters,
// and a thousand steps of it a third of a megabyte. Kept in the browser with the run, so that undo
// survives a reload; only the newest steps that fit in `ROOM` are kept there, all of them in memory.
//
//   let steps = begun("v1");
//   steps = recorded(steps, write(run));     // after each change
//   steps = undone(steps); steps.texts[steps.at];

/** Every state of the run, oldest first, and the one shown now. */
export interface Steps {
    texts: string[];
    at: number;
}

/** How many characters of steps are kept in the browser, at most: well inside what a page may keep there. */
export const ROOM = 1_000_000;

/** Steps with one state, the run as it starts. */
export const begun = (text: string): Steps => ({ texts: [text], at: 0 });

/** A new state after the one shown: whatever had been undone past it is gone. The same state again is no step. */
export function recorded(steps: Steps, text: string): Steps {
    if (steps.texts[steps.at] === text) return steps;
    return { texts: [...steps.texts.slice(0, steps.at + 1), text], at: steps.at + 1 };
}

/** A step back, if there is one. */
export const undone = (steps: Steps): Steps => ({ ...steps, at: Math.max(0, steps.at - 1) });
/** A step forward again, if one was undone. */
export const redone = (steps: Steps): Steps => ({ ...steps, at: Math.min(steps.texts.length - 1, steps.at + 1) });
/** Whether there is a step to go back or forward to. */
export const canUndo = (steps: Steps) => steps.at > 0;
export const canRedo = (steps: Steps) => steps.at < steps.texts.length - 1;

/** The steps to keep in the browser: the newest that fit in `room` characters, and always the one shown and those after it. */
export function trimmed(steps: Steps, room = ROOM): Steps {
    let used = 0;
    let first = steps.texts.length;
    while (first > 0 && (first > steps.at || used + steps.texts[first - 1]!.length <= room)) used += steps.texts[--first]!.length;
    return { texts: steps.texts.slice(first), at: steps.at - first };
}

/** Steps read back from the browser, checked: anything that is not steps gives none. */
export function readSteps(kept: unknown): Steps | undefined {
    const steps = kept as Steps | undefined;
    if (!steps || !Array.isArray(steps.texts) || !steps.texts.length || !steps.texts.every((text) => typeof text === "string")) return undefined;
    if (!Number.isInteger(steps.at) || steps.at < 0 || steps.at >= steps.texts.length) return undefined;
    return { texts: [...steps.texts], at: steps.at };
}
