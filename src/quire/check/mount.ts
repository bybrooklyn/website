// Where checking joins the editor: one call from editor.ts, which gives the surface, the bar and
// where the document lives. Nothing of checking is loaded until it is first used: the code (view.ts
// and the rules) comes with the first press of Tools, Checking, and the dictionary only when
// spelling is on. After that the browser remembers it was on, and the editor loads it on opening.
//
//   const checking = mountChecking({ surface, bar: bar.element, where: () => ({ store, id, name }) });
//   checking.open(from)     opens the settings from a control, switching checking on the first time
//   checking.destroy()

import type { Surface } from "../surface";
import type { Store } from "../store";
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
}

/** Checking as the editor holds it. */
export interface Checking {
    open(from: HTMLElement): void;
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

/** Joins checking to the editor, loading it now only if it was on the last time. */
export function mountChecking(host: CheckingHost): Checking {
    const keep = host.keep ?? browserKeep();
    let view: Promise<{ openSettings(from: HTMLElement, switchOn: boolean): void; destroy(): void }> | undefined;
    let gone = false;
    const load = () => (view ??= import("./view").then(({ createChecking }) => createChecking({ ...host, keep })));
    if (loadPrefs(keep).on) void load();
    return {
        open(from) {
            void load().then((shown) => !gone && shown.openSettings(from, true));
        },
        destroy() {
            gone = true;
            void view?.then((shown) => shown.destroy());
        },
    };
}
