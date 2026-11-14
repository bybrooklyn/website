// Where checking joins the editor: one call from editor.ts, which gives the surface, the bar and
// where the document lives. Spelling is on until she switches checking off (findings.ts), so the
// code (view.ts and the rules) and the dictionary are loaded when the editor opens, in the
// background; for a writer who switched it off nothing of checking loads until Tools, Checking.
//
//   const checking = mountChecking({ surface, bar: bar.element, where: () => ({ store, id, name }) });
//   checking.open(from)        opens what was found from a control, switching checking on if it was off
//   checking.dictionary(from)  her own dictionary, listed
//   checking.linesAt(point)    the lines a misspelled word puts first in the text's menu
//   checking.destroy()

import type { Surface } from "../surface";
import type { Store } from "../store";
import type { MenuItem } from "../ui";
import { loadPrefs, type Keep } from "./findings";

/** What checking is given by the editor. */
export interface CheckingHost {
    surface: Surface;
    /** The editor's bar: the count goes at its end. */
    bar: HTMLElement;
    /** Where the document is kept, for links to files beside it and for what is ignored in it. */
    where: () => { store?: Store; id?: string; name: string };
    /** Where the dictionary is fetched from. */
    dictionary?: string;
    /** Where settings and her own words are kept; the browser's localStorage if not given. */
    keep?: Keep;
    /** Lays the bar out again, once the count at its end has grown in or gone, so that its tools fold to make room. */
    relayout?: () => void;
}

/** Checking as the editor holds it. */
export interface Checking {
    open(from: HTMLElement): void;
    /** Opens Personal dictionary, her own words, from a control. */
    dictionary(from: HTMLElement): void;
    /** The lines a misspelled word at a point (or at the caret, with none) puts first in the text's menu, ending in their rule; none until checking has loaded. */
    linesAt(at?: { x: number; y: number }): MenuItem[];
    destroy(): void;
}

/** The browser's localStorage, or nothing where it cannot be had. */
export function browserKeep(): Keep | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

/** Joins checking to the editor, loading it now unless she switched it off. */
export function mountChecking(host: CheckingHost): Checking {
    const keep = host.keep ?? browserKeep();
    let view: Promise<ReturnType<typeof import("./view").createChecking>> | undefined;
    let loaded: Awaited<NonNullable<typeof view>> | undefined;
    let gone = false;
    const load = () =>
        (view ??= import("./view").then(({ createChecking }) => {
            loaded = createChecking({ ...host, keep });
            return loaded;
        }));
    if (loadPrefs(keep).on) void load();
    return {
        open(from) {
            void load().then((shown) => !gone && shown.openResults(from));
        },
        dictionary(from) {
            void load().then((shown) => !gone && shown.openDictionary(from));
        },
        linesAt: (at) => (loaded && !gone ? loaded.linesAt(at) : []),
        destroy() {
            gone = true;
            void view?.then((shown) => shown.destroy());
        },
    };
}
