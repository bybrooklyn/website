// Looks: grades saved under a name, to be given to another picture, and the Grade surface's Looks
// section where they are saved, applied and taken away, and where a .cube file is read into a grade
// or a grade written as one (cube.ts). Looks are kept in this browser, in a database of their own
// (`quire-img-looks`, beside the Quires' own `quire`), one record a look; a look goes to another
// machine as a .cube file.
//
//   const store = lookStore();
//   await store.save({ name: "Warm evening", grade: trimGrade(grade), saved: Date.now() });
//   const section = gradeLooks({ store, grade, set, say, name, space, give });

import { control, icon, make } from "../core/ui";
import { readCube, writeCube } from "./cube";
import { readGrade, trimGrade, type Grade, type KeptGrade, type Space } from "./grade";

/** A look as it is kept: its name, its grade (only what is away from zero), and when it was saved. */
export interface SavedLook {
    name: string;
    grade: KeptGrade;
    saved: number;
}

/** The database looks are kept in, and its one store. */
export const LOOKS = { database: "quire-img-looks", store: "looks" };

/** The most looks kept, and the longest name. */
export const MOST_LOOKS = { count: 200, name: 80 };

/** A name not yet taken: the one wanted, or with a number after it, as "Warm (2)". */
export function freeName(taken: string[], wanted: string): string {
    const base = wanted.trim().slice(0, MOST_LOOKS.name) || "Look";
    if (!taken.includes(base)) return base;
    for (let at = 2; ; at++) if (!taken.includes(`${base} (${at})`)) return `${base} (${at})`;
}

/** A look read back from the database, checked as a file would be: its grade read field by field, a name of text. */
export function readLook(value: unknown): SavedLook | undefined {
    const look = value as Partial<SavedLook> | null;
    if (!look || typeof look.name !== "string" || !look.name.trim()) return undefined;
    return { name: look.name.slice(0, MOST_LOOKS.name), grade: trimGrade(readGrade(look.grade)), saved: typeof look.saved === "number" && Number.isFinite(look.saved) ? look.saved : 0 };
}

/** The looks kept in this browser's database: listed newest first, saved, taken away. */
export function lookStore(name = LOOKS.database) {
    let opened: Promise<IDBDatabase> | undefined;
    const open = () =>
        (opened ??= new Promise<IDBDatabase>((done, fail) => {
            const asked = indexedDB.open(name, 1);
            asked.onupgradeneeded = () => asked.result.createObjectStore(LOOKS.store, { keyPath: "name" });
            asked.onsuccess = () => done(asked.result);
            asked.onerror = () => fail(asked.error ?? new Error("the looks could not be opened"));
        }));
    const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
        const database = await open();
        return new Promise<T>((done, fail) => {
            const request = work(database.transaction(LOOKS.store, mode).objectStore(LOOKS.store));
            request.onsuccess = () => done(request.result);
            request.onerror = () => fail(request.error ?? new Error("the looks could not be reached"));
        });
    };
    return {
        async list(): Promise<SavedLook[]> {
            const all = await run<unknown[]>("readonly", (store) => store.getAll());
            return all
                .map(readLook)
                .filter((each): each is SavedLook => !!each)
                .sort((a, b) => b.saved - a.saved)
                .slice(0, MOST_LOOKS.count);
        },
        async save(look: SavedLook): Promise<void> {
            await run("readwrite", (store) => store.put(look));
        },
        async remove(name: string): Promise<void> {
            await run("readwrite", (store) => store.delete(name));
        },
    };
}

/** The looks, as the editor holds them. */
export type LookStore = ReturnType<typeof lookStore>;

/** What the Looks section needs of the editor. */
export interface LooksHooks {
    store: LookStore;
    grade(): Grade;
    set(grade: Grade): void;
    say(short: string, full: string, warn?: boolean): void;
    /** A name to start a look's from: the document's. */
    name(): string;
    space(): Space;
    /** Hands her a file. */
    give(blob: Blob, name: string): void;
}

/** The Looks section: a name and Save, the looks kept (each pressed to apply, with a way to take it away), the .cube in this grade if there is one, and Read .cube and Write .cube. */
export function gradeLooks(hooks: LooksHooks) {
    const element = make("div", "quire-img-looks");
    const save = make("div", "quire-img-look-save");
    const field = make("input", "quire-field quire-img-look-name");
    field.placeholder = "Name of the look";
    field.setAttribute("aria-label", "Name of the look");
    field.maxLength = MOST_LOOKS.name;
    const keep = make("button", "quire-dialog-dismiss quire-img-grade-fix", "Save look");
    keep.type = "button";
    keep.title = "Keeps this grade as a look, in this browser, to give to other pictures";
    save.append(field, keep);
    const list = make("div", "quire-img-look-list");
    list.setAttribute("role", "list");
    const inGrade = make("div", "quire-img-look-in");
    const files = make("div", "quire-img-grade-fixes");
    const chooser = make("input");
    chooser.type = "file";
    chooser.accept = ".cube";
    chooser.hidden = true;
    const button = (label: string, tip: string, press: () => void) => {
        const made = make("button", "quire-dialog-dismiss quire-img-grade-fix", label);
        made.type = "button";
        made.title = tip;
        made.addEventListener("click", press);
        return made;
    };
    files.append(
        button("Read .cube", "Reads a .cube look into this grade, applied last", () => chooser.click()),
        button("Write .cube", "Saves this grade as a .cube file, 33 a side, for other editors", () => {
            const name = (field.value.trim() || hooks.name() || "look").slice(0, MOST_LOOKS.name);
            hooks.give(new Blob([writeCube(hooks.grade(), hooks.space(), name)], { type: "text/plain" }), `${name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "look"}.cube`);
            hooks.say("Written", `Written as ${name}.cube, 33 a side`);
        }),
        chooser,
    );
    element.append(save, list, inGrade, files);

    keep.addEventListener("click", () => void saveLook());
    field.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key !== "Enter") return;
        event.preventDefault();
        void saveLook();
    });
    async function saveLook() {
        try {
            const looks = await hooks.store.list();
            const name = freeName(
                looks.map((each) => each.name),
                field.value || `${hooks.name() || "Look"}`,
            );
            await hooks.store.save({ name, grade: trimGrade(hooks.grade()), saved: Date.now() });
            field.value = "";
            hooks.say("Look saved", `Saved as the look ${name}`);
            await fill();
        } catch (error) {
            hooks.say("Not saved", `The look was not saved: ${error instanceof Error ? error.message : String(error)}`, true);
        }
    }
    chooser.addEventListener("change", async () => {
        const file = chooser.files?.[0];
        chooser.value = "";
        if (!file) return;
        try {
            if (file.size > 24 * 1024 * 1024) throw new Error("the file is too large to be a look");
            const lut = readCube(await file.text(), file.name);
            hooks.set({ ...hooks.grade(), lut });
            hooks.say("Look read", `${lut.name ?? file.name} is in this grade, ${lut.kind === "3d" ? `${lut.size} a side` : `${lut.size} entries`}`);
        } catch (error) {
            hooks.say("Not read", `That .cube could not be read: ${error instanceof Error ? error.message : String(error)}`, true);
        }
        void fill();
    });
    async function fill() {
        const lut = hooks.grade().lut;
        inGrade.replaceChildren(...(lut ? [make("span", "", `In this grade: ${lut.name ?? "a .cube look"}`), control("Take the .cube look out of this grade", icon("close"), () => hooks.set({ ...hooks.grade(), lut: undefined }))] : []));
        inGrade.classList.toggle("away", !lut);
        const looks = await hooks.store.list().catch(() => [] as SavedLook[]);
        list.replaceChildren(
            ...looks.map((look) => {
                const row = make("div", "quire-img-look");
                row.setAttribute("role", "listitem");
                const apply = make("button", "quire-img-look-apply", look.name);
                apply.type = "button";
                apply.title = "Gives this grade the look, in place of what it has";
                apply.addEventListener("click", () => {
                    hooks.set(readGrade(look.grade));
                    hooks.say("Look applied", `The look ${look.name} is this grade now; every control can still be changed`);
                });
                const remove = control(`Forget the look ${look.name}`, icon("trash"), async () => {
                    await hooks.store.remove(look.name).catch(() => undefined);
                    void fill();
                });
                row.append(apply, remove);
                return row;
            }),
        );
    }
    return { element, fill, field, chooser };
}
