// Words with their times, as the recognizers give them to the session, and the two small things done
// with them: comparing two words by their letters, and spreading a transcript that has no times over
// the stretch of sound it came from. Words carry times in seconds from the start of the dictation.
//
// (This file once also put together the answers of windows of sound that overlapped. The session
// asks about windows that do not overlap and settles each answer whole, so that went.)

/** A word and where it was heard. */
export interface Word {
    text: string;
    start: number;
    end: number;
}

/** A word reduced to what is compared: letters and digits, lowercase. */
export const same = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Words with times spread evenly over a stretch, for a recognizer that gives text alone. */
export function spread(text: string, start: number, end: number): Word[] {
    const parts = text.split(/\s+/).filter(Boolean);
    const each = (end - start) / Math.max(1, parts.length);
    return parts.map((part, index) => ({ text: part, start: start + index * each, end: start + (index + 1) * each }));
}
