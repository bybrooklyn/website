// A button that copies words for the visitor and says so on itself for a moment: "copy" under a
// post's citation (Contents.astro), and the minis' links and passwords. The button keeps its width
// while its words change, so that nothing beside it moves.

/**
 * Copies `text` and puts `done` on the button, or `failed`, if given, when the browser will not copy.
 * Where there is no clipboard at all the button is left as it is. Its own words, `rest`, come back
 * after two and a half seconds.
 */
export function copyText(button: HTMLButtonElement, text: string, words: { rest: string; done: string; failed?: string }): void {
    button.style.minWidth = `${button.offsetWidth}px`;
    navigator.clipboard?.writeText(text).then(
        () => (button.textContent = words.done),
        () => words.failed && (button.textContent = words.failed),
    );
    setTimeout(() => (button.textContent = words.rest), 2500);
}

/**
 * Copies `text` and marks the button as having copied (`data-copied`) for two and a half seconds,
 * for a button whose words are more than plain text and are swapped by its stylesheet. The button
 * keeps its width while it is marked.
 */
export function copyMarked(button: HTMLButtonElement, text: string): void {
    navigator.clipboard?.writeText(text).then(
        () => {
            button.style.minWidth = `${button.offsetWidth}px`;
            button.dataset.copied = "";
            setTimeout(() => {
                delete button.dataset.copied;
                button.style.minWidth = "";
            }, 2500);
        },
        () => {},
    );
}
