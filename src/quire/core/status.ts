// The two pieces of the top that are the frame's own, whatever kind of document is open: the
// document's name at the end of the trail, from which the documents list grows, and the status at
// the right of the first line, how saving stands with a count beside it ("Saved · 7 words"). A
// message said there passes after a few seconds and gives the place back to how saving stands.
//
//   const name = nameButton("Untitled", (button) => openList(button));
//   const status = statusLine();  status.say("Saved", "Saved", "quiet", true);  status.count("7 words");

import { icon, make } from "./ui";

/** How long a message in the status stays before how saving stands comes back, in milliseconds. */
export const STATUS_PASSES = 5000;

/** The name in the trail: a button with a way to change what it says. */
export type NameButton = HTMLButtonElement & { set(value: string): void };

/** The document's name as a button: pressed, the documents list grows out of it. */
export function nameButton(first: string, press: (button: HTMLButtonElement) => void): NameButton {
    const name = make("button", "quire-button quire-name") as NameButton;
    name.type = "button";
    name.setAttribute("aria-haspopup", "menu");
    const nameText = make("span", "quire-name-text", first);
    name.append(nameText, icon("chevron"));
    name.set = (value: string) => {
        nameText.textContent = value;
        name.title = value;
        name.setAttribute("aria-label", `${value}: documents`);
    };
    name.set(first);
    name.addEventListener("mousedown", (event) => event.preventDefault());
    name.addEventListener("click", () => press(name));
    return name;
}

/** The status line: what is said, a dot, and a count the kind of document fills. */
export function statusLine() {
    // the count is not announced as it changes, which in a run of typing would be every quarter second; the word count dialog says it on request
    const count = make("span", "quire-count");
    const status = make("span", "quire-status");
    status.setAttribute("role", "status");
    let words = make("span", "quire-status-words here");
    status.append(words);
    const element = make("p", "quire-status-line");
    const dot = make("span", "quire-status-dot", "·");
    dot.setAttribute("aria-hidden", "true");
    element.append(status, dot, count);
    const show = (short: string, full: string, tone: "quiet" | "warn") => {
        status.title = full;
        status.setAttribute("aria-label", full);
        status.classList.toggle("warn", tone === "warn");
        // with nothing said about saving, the dot goes with it (a class, so that no rule has to look inside to know)
        element.classList.toggle("unsaid", !short);
        if (words.textContent === short) return;
        // the new words fade in where the old ones fade out, so that nothing beside them moves
        const leaving = words;
        words = make("span", "quire-status-words", short);
        status.append(words);
        leaving.classList.remove("here");
        requestAnimationFrame(() => words.classList.add("here"));
        setTimeout(() => leaving.remove(), 400);
    };
    /** How saving stands, which stays until it changes; a message passes after a few seconds and gives the place back to it. */
    let standing: [string, string, "quiet" | "warn"] = ["", "", "quiet"];
    let passing: ReturnType<typeof setTimeout> | undefined;
    return {
        element,
        /** Says something. A message passes after a few seconds; with `stays`, how saving stands, it stays until the next. */
        say(short: string, full: string, tone: "quiet" | "warn" = "quiet", stays = false) {
            clearTimeout(passing);
            if (stays) standing = [short, full, tone];
            else passing = setTimeout(() => show(...standing), STATUS_PASSES);
            show(short, full, tone);
        },
        /** Puts the count beside it, as the kind of document words it. */
        count(text: string) {
            count.textContent = text;
        },
        destroy: () => clearTimeout(passing),
    };
}

/** The status the frame shows for how saving stands, in a word or two. */
export type StatusLine = ReturnType<typeof statusLine>;
