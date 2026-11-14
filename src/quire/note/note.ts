// A plain note: the smallest kind of document the core takes, kept to show what a Quire gives the
// core and as the start imgQuire is to be built from (docs/quire-core.md). A note is plain text in a
// file ending `.note`. Its editor is a text field in the core's frame, its session the core's, and it
// has two commands of its own, on its menus, its bar, the palette and a key: Insert the date
// (Ctrl+Shift+D) and Tidy the lines (spaces left at their ends taken away).
//
//   startApp(host, { kinds: [markdown(), note()] });

import { createFrame } from "../core/frame";
import type { Context, Editing, Kind } from "../core/kind";
import { createSession } from "../core/session";
import { control, icon, make, type MenuItem } from "../core/ui";

/** True for a note's file name. */
export const noteName = (name: string): boolean => /\.note$/i.test(name);

/** The text with the date put in at a place, and where the caret then goes. */
export function stamp(text: string, at: number, today: Date): { text: string; at: number } {
    const day = today.toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
    return { text: text.slice(0, at) + day + text.slice(at), at: at + day.length };
}

/** The text with the spaces and tabs at the end of each line taken away. */
export const tidy = (text: string): string => text.replace(/[ \t]+$/gm, "");

/** How many lines a note has, as its status says it. */
export const linesIn = (text: string): string => {
    const count = text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
    return `${count} ${count === 1 ? "line" : "lines"}`;
};

/** The plain note, as a kind of document. */
export function note(): Kind {
    return {
        key: "note",
        name: "Note",
        opens: noteName,
        starts: () => [{ key: "note", label: "note", name: "Untitled.note", text: "", quire: false, said: "Note", icon: "text" }],
        files: { description: "Notes", accept: { "text/plain": [".note"] }, chooser: ".note" },
        row: "note",
        mount,
    };
}

/** Mounts a note's editor: a text field on a sheet, in the core's frame, held by the core's session. */
function mount(host: HTMLElement, context: Context): Editing {
    host.classList.add("quire-editor");
    const frame = createFrame(host, { top: context.top, name: context.start?.entry.name ?? "Untitled", onName: context.onName });
    const paper = make("div", "quire-paper quire-note");
    const text = make("textarea", "quire-note-text");
    text.setAttribute("aria-label", "Note");
    text.value = context.start?.found.text ?? "";
    paper.append(text);
    const column = make("div", "quire-column");
    column.append(paper);
    host.append(column);
    const count = () => frame.status.count(linesIn(text.value));

    const session = createSession(
        {
            writing: () => ({ text: text.value }),
            load: (found) => void ((text.value = found.text), count()),
            replace: (found) => void ((text.value = found.text), count()),
            empty: () => void ((text.value = ""), count()),
            placed: () => {},
            named: (name) => frame.name.set(name),
            download: () => {},
            from: () => frame.status.element,
            focus: () => text.focus(),
        },
        { name: context.start?.entry.name ?? "Untitled", store: context.start?.store, id: context.start?.entry.id, mark: context.start?.found.mark, versions: context.versions, say: frame.status.say, onOpen: context.onOpen },
    );
    const edited = () => (count(), session.changed());
    text.addEventListener("input", edited);
    count();

    // its two commands, from its menus, its bar, the palette and Ctrl+Shift+D
    const commands = {
        stamp: () => {
            const done = stamp(text.value, text.selectionStart, new Date());
            text.value = done.text;
            text.setSelectionRange(done.at, done.at);
            text.focus();
            edited();
        },
        tidy: () => {
            text.value = tidy(text.value);
            text.focus();
            edited();
        },
    };
    const lines: Record<keyof typeof commands, MenuItem> = {
        stamp: { label: "Insert the date", key: "stamp", icon: "date", hint: "Ctrl+Shift+D", run: commands.stamp },
        tidy: { label: "Tidy the lines", key: "tidy", icon: "clear", run: commands.tidy },
    };
    frame.menus(() => [
        { label: "File", items: () => context.fileItems() },
        { label: "Edit", items: () => [lines.stamp, lines.tidy] },
    ]);
    frame.keys((event) => (event.ctrlKey && event.shiftKey && !event.altKey && event.code === "KeyD" ? commands.stamp : undefined));
    frame.palette({ writing: () => text, back: () => text.focus() });
    const bar = make("div", "quire-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Note");
    bar.append(control("Insert the date (Ctrl+Shift+D)", icon("date"), commands.stamp), control("Tidy the lines", icon("clear"), commands.tidy));
    frame.place("bar").append(bar);

    return {
        paper,
        open: session.open,
        create: session.create,
        ready: session.ready,
        leave: session.leave,
        flush: session.flush,
        rename: session.rename,
        current: session.current,
        status: session.status,
        nameElement: () => frame.name,
        say: (short, full) => frame.status.say(short, full, "warn"),
        focus: () => text.focus(),
        destroy() {
            session.destroy();
            frame.destroy();
            host.replaceChildren();
        },
    };
}
