// What is known about the document, quiet in the right margin of the look with no page: its file,
// its length and how long it takes to read, and where it is kept and when it was last saved there.
//
//   const details = createDetails();
//   details.show({ file, words, place, saved });
//
// The words are made by `lengthLine` and `keptLine`, which are pure and tested.

import { make } from "./ui";

/** How many words a minute a reader takes in, as a blog's "minutes to read" counts them. */
const PACE = 238;

/** A document's length and the time it takes to read, as a line. */
export function lengthLine(words: number): string {
    if (words === 0) return "Nothing written yet";
    const counted = `${words.toLocaleString("en")} ${words === 1 ? "word" : "words"}`;
    const minutes = Math.round(words / PACE);
    return minutes < 1 ? `${counted}, under a minute to read` : `${counted}, ${minutes} ${minutes === 1 ? "minute" : "minutes"} to read`;
}

/** How long ago something happened, in words. */
export function ago(then: number, now: number): string {
    const minutes = Math.floor((now - then) / 60_000);
    if (minutes < 1) return "a moment ago";
    if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
    return new Date(then).toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

/** Where the document is kept and when it was last saved there, as a line; a document kept nowhere says so. */
export function keptLine(place: string | undefined, saved: number | undefined, now: number): string {
    if (!place) return "Not kept anywhere";
    const where = place === "This browser" ? "In this browser" : place;
    return saved === undefined ? where : `${where}, ${ago(saved, now)}`;
}

/** How large a document's file is, in the units a file manager uses, and how many pictures are kept beside it. */
export function sizeLine(bytes: number, pictures = 0): string {
    const size = bytes < 1000 ? `${bytes.toLocaleString("en")} ${bytes === 1 ? "byte" : "bytes"}` : bytes < 1_000_000 ? `${(bytes / 1000).toFixed(1)} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
    return pictures === 0 ? size : `${size}, and ${pictures} ${pictures === 1 ? "picture" : "pictures"} kept beside it`;
}

/** What the margin shows. */
export interface Shown {
    file: string;
    words: number;
    place?: string;
    saved?: number;
}

/** Builds the details, empty until shown. */
export function createDetails() {
    const list = make("dl", "quire-details");
    list.setAttribute("aria-label", "About this document");
    const line = (term: string) => {
        const value = make("dd");
        list.append(make("dt", "", term), value);
        return value;
    };
    const file = line("File");
    const length = line("Length");
    const kept = line("Kept");
    let last: Shown | undefined;
    const draw = () => {
        if (!last) return;
        file.textContent = last.file;
        length.textContent = lengthLine(last.words);
        kept.textContent = keptLine(last.place, last.saved, Date.now());
    };
    // "a moment ago" becomes "a minute ago" without anything else happening
    const ticking = setInterval(draw, 30_000);
    return {
        element: list,
        show(next: Shown) {
            last = next;
            draw();
        },
        destroy() {
            clearInterval(ticking);
            list.remove();
        },
    };
}
