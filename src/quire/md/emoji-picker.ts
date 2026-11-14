// The emoji list, as Discord has it in mdQuire's own manner: a colon and two letters typed open a
// small list by the cursor of the emoji whose names (or other words) start with them, narrowing as
// more is typed. Up and Down move, Tab or Enter puts the emoji in place of what was typed; Escape,
// a space, or any character that cannot be in a name closes it and leaves the text exactly as typed,
// so ignoring it changes nothing. It is never offered in code, and a line starting `: ` (a
// definition) is not touched. Typing the closing colon of a known name still turns it into its
// emoji (keys.ts), list or no list. The list grows out of the cursor as the slash menu does.
//
//
// The emoji grid is the other way in, from Insert, Emoji, the palette or Ctrl+;: a menu holding a
// search field, the groups along the top with what was used lately first, and the emoji of one
// group in a grid the arrow keys move through. It stays open while several are put in. A skin tone
// is chosen with the small hand beside the search, or by holding an emoji down.
//
// What is typed and what matches, the groups, the tones and what was used lately are pure and
// tested; the rest is DOM.

import { blockAt, deleteText, insertAtom, runsText, sliceRuns, type Document, type Run } from "./document";
import { EMOJI, EMOJI_WORDS } from "./emoji";
import type { State } from "./history";
import { typeIn } from "./inserts";
import { caret } from "./keys";
import type { Surface } from "./surface";
import { composing, flowMenu, make, markActive, unmarkActive, type MenuItem } from "../ui";

/** What has been typed after a colon just before the cursor, two letters or more of a name; undefined when no list should be open. */
export function emojiQuery(doc: Document, path: number[], offset: number): string | undefined {
    const block = blockAt(doc, path);
    if (block?.kind !== "paragraph" && block?.kind !== "heading") return undefined;
    const before = runsText(block.runs).slice(0, offset);
    // the colon starts a word: at the start, or after a space or an opening sign, never after a letter or digit (10:30, http:)
    const found = /(?:^|[\s([{"'“‘])(:([a-z0-9_+-]{2,}))$/i.exec(before);
    if (!found) return undefined;
    // never in code
    const start = offset - found[1]!.length;
    const piece = sliceRuns(block.runs, start, offset);
    if (piece.some((run) => run.kind === "text" && run.marks.includes("code"))) return undefined;
    return found[2]!.toLowerCase();
}

/** The emoji a query finds, names that start with it first, then names with a part that does, then other words; at most `limit`. */
export function matchEmoji(query: string, limit = 8): { name: string; emoji: string }[] {
    const wanted = query.toLowerCase();
    const names = Object.keys(EMOJI);
    const starts = names.filter((name) => name.startsWith(wanted)).sort((a, b) => a.length - b.length);
    const parts = names.filter((name) => !starts.includes(name) && name.split("_").some((part) => part.startsWith(wanted)));
    const words = names.filter((name) => !starts.includes(name) && !parts.includes(name) && (EMOJI_WORDS[name] ?? []).some((word) => word.startsWith(wanted)));
    return [...starts, ...parts, ...words].slice(0, limit).map((name) => ({ name, emoji: EMOJI[name]! }));
}

/** Takes away the colon and what followed it, and puts the emoji there. */
export function chooseEmoji(state: State, name: string): State {
    const { path, offset } = state.selection.focus;
    const query = emojiQuery(state.doc, path, offset);
    if (query === undefined) return state;
    const start = offset - query.length - 1;
    const doc = insertAtom(deleteText(state.doc, { start: { path, offset: start }, end: { path, offset } }), { path, offset: start }, { kind: "emoji", name } as Run & { kind: "emoji" });
    return { doc, selection: caret(path, start + 1) };
}

/** Builds the emoji list for a surface. */
export function createEmojiPicker(surface: Surface): { close(): void } {
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    document.body.append(anchor);
    const menu = flowMenu("Emoji", {
        className: "quire-slash quire-emoji-list",
        onClose: () => {
            open = false;
            unmarkActive(surface.element);
        },
    });
    let open = false;
    let active = 0;
    let shown: { name: string; emoji: string }[] = [];
    // a list put away with Escape stays away for the rest of that name
    let dismissed = "";
    const startOf = () => {
        const { path, offset } = surface.getSelection().focus;
        const query = emojiQuery(surface.getDocument(), path, offset);
        return query === undefined ? "" : `${path.join(",")}:${offset - query.length}`;
    };

    const choose = (name: string) => {
        menu.close(false);
        surface.run((doc, selection) => chooseEmoji({ doc, selection }, name), "type");
        surface.focus();
    };
    const lines = (): MenuItem[] => shown.map((each) => ({ label: `${each.emoji}  ${each.name.replace(/_/g, " ")}`, hint: `:${each.name}:`, run: () => choose(each.name) }));
    const mark = () => markActive(menu, surface.element, active);
    const look = () => {
        const { path, offset } = surface.getSelection().focus;
        const query = emojiQuery(surface.getDocument(), path, offset);
        // switched off in Typing preferences, no list comes
        shown = query === undefined || startOf() === dismissed || surface.typingOff().has("emojiList") ? [] : matchEmoji(query);
        if (shown.length === 0) return menu.close(false);
        active = Math.min(active, shown.length - 1);
        const selection = getSelection();
        const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : undefined;
        if (rect && (rect.width || rect.height)) {
            anchor.style.left = `${rect.left}px`;
            anchor.style.top = `${rect.top}px`;
            anchor.style.height = `${Math.max(rect.height, 16)}px`;
        }
        // open, it is filled again in place; closed, it grows out of the cursor
        menu.open(anchor, lines());
        open = true;
        mark();
    };
    // it opens and narrows as a name is typed, and closes as soon as what is before the cursor is no longer one
    surface.on("change", () => {
        if (!open) active = 0;
        look();
    });
    surface.on("select", () => {
        if (!open) return;
        const { path, offset } = surface.getSelection().focus;
        if (emojiQuery(surface.getDocument(), path, offset) === undefined) menu.close(false);
    });
    surface.element.addEventListener(
        "keydown",
        (event) => {
            if (!open || event.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                active = (active + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
                mark();
            } else if (event.key === "Enter" || event.key === "Tab") {
                const pick = shown[active];
                if (pick) choose(pick.name);
            } else if (event.key === "Escape") {
                dismissed = startOf();
                menu.close(false);
            } else return;
            event.preventDefault();
            event.stopImmediatePropagation();
        },
        true,
    );
    return { close: () => menu.close(false) };
}

// ---- the emoji grid ----

/**
 * The groups along the top of the grid, as Docs names them, each with the emoji its tab shows. The
 * table in emoji.ts is kept in runs of a kind; `starts` names the first of each run that belongs
 * here, and an emoji belongs to the group of the last run started before it.
 */
export const GROUPS: { key: string; label: string; sign: string; starts: string[] }[] = [
    { key: "people", label: "Smileys and people", sign: "\u{1F642}", starts: ["smile", "smiling_face_with_tear", "raised_back_of_hand"] },
    { key: "nature", label: "Animals and nature", sign: "\u{1F43B}", starts: ["rainbow", "seedling", "monkey_face", "snowman"] },
    { key: "food", label: "Food and drink", sign: "\u{1F354}", starts: ["coffee", "strawberry"] },
    { key: "activities", label: "Activities", sign: "\u{26BD}", starts: ["tada", "soccer"] },
    { key: "travel", label: "Travel and places", sign: "\u{1F697}", starts: ["volcano", "house"] },
    { key: "objects", label: "Objects", sign: "\u{1F4A1}", starts: ["bulb", "tv", "stopwatch"] },
    { key: "symbols", label: "Symbols", sign: "\u{2764}\u{FE0F}", starts: ["heart", "boom", "100", "arrow_right", "kiss", "heavy_plus_sign"] },
    { key: "flags", label: "Flags", sign: "\u{1F3F3}\u{FE0F}", starts: ["transgender_flag", "white_flag"] },
];

/** The emoji of each group, by name, in the table's order. */
export function grouped(): Map<string, string[]> {
    const groupOf = new Map(GROUPS.flatMap((group) => group.starts.map((name) => [name, group.key] as const)));
    const out = new Map(GROUPS.map((group) => [group.key, [] as string[]]));
    const seen = new Set<string>();
    let now = GROUPS[0]!.key;
    for (const name of Object.keys(EMOJI)) {
        now = groupOf.get(name) ?? now;
        // a second name for the same emoji (thumbsup for +1) is shown once, by its first
        if (!seen.has(EMOJI[name]!)) out.get(now)!.push(name);
        seen.add(EMOJI[name]!);
    }
    return out;
}

/** The emoji that take a skin tone: hands and people. */
const TONED = new Set("wave raised_hand ok_hand v crossed_fingers point_right point_left point_up point_down +1 -1 clap raised_hands pray muscle raised_back_of_hand vulcan_salute pinched_fingers pinching_hand love_you_gesture metal call_me_hand fist facepunch open_hands palms_up_together writing_hand nail_care selfie ear nose baby person_shrugging facepalm person_raising_hand technologist artist scientist ninja superhero mage fairy dancer running walking".split(" "));

/** The five skin tones, lightest first, after the yellow every emoji has with none. */
const TONES = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];

/** True when an emoji can be drawn in a skin tone. */
export const takesTone = (name: string) => TONED.has(name);

/** An emoji as a character, in a skin tone from 1 to 5 if it takes one: the tone follows its first character, in place of the sign asking for a picture. */
export function toned(name: string, tone = 0): string {
    const emoji = EMOJI[name] ?? "";
    if (!tone || !TONED.has(name)) return emoji;
    const [first, ...rest] = [...emoji];
    return first + TONES[tone - 1]! + rest.join("").replace(/^\uFE0F/, "");
}

/** One emoji put in, as what was used lately keeps it: its name and the tone it was put in. */
export interface Used {
    name: string;
    tone: number;
}

/** How many emoji the grid remembers as used lately: three rows. */
const KEPT = 24;

/** What was used lately, from what the browser kept: anything not a known emoji in a known tone is let go. */
export function readUsed(kept: string | null): Used[] {
    let raw: unknown;
    try {
        raw = JSON.parse(kept ?? "[]");
    } catch {
        return [];
    }
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((each): each is Used => !!each && typeof each === "object" && Object.hasOwn(EMOJI, each.name) && Number.isInteger(each.tone) && each.tone >= 0 && each.tone <= 5)
        .map((each) => ({ name: each.name, tone: TONED.has(each.name) ? each.tone : 0 }))
        .slice(0, KEPT);
}

/** What was used lately with one more put in: it comes first, once. */
export function used(before: Used[], put: Used): Used[] {
    return [put, ...before.filter((each) => each.name !== put.name || each.tone !== put.tone)].slice(0, KEPT);
}

/**
 * Puts an emoji in at the cursor, over what is selected. Where text can hold it, it is written as
 * its shortcode, as the colon list writes it; in a skin tone, which no shortcode says, or in code,
 * it is the character itself.
 */
export function putEmoji(state: State, name: string, tone = 0): State {
    const char = toned(name, tone);
    const typed = typeIn(state, char);
    if (typed === state || (tone && TONED.has(name))) return typed;
    const { path, offset } = typed.selection.focus;
    const block = blockAt(typed.doc, path);
    const start = offset - char.length;
    if (block?.kind !== "paragraph" && block?.kind !== "heading") return typed;
    if (runsText(block.runs).slice(start, offset) !== char || sliceRuns(block.runs, start, offset).some((run) => run.kind === "text" && run.marks.includes("code"))) return typed;
    const doc = insertAtom(deleteText(typed.doc, { start: { path, offset: start }, end: { path, offset } }), { path, offset: start }, { kind: "emoji", name } as Run & { kind: "emoji" });
    return { doc, selection: caret(path, start + 1) };
}

const USED_KEY = "quire-emoji-used";
const TONE_KEY = "quire-emoji-tone";

/** Reads what this browser kept, or nothing where it keeps nothing. */
const kept = (key: string) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const keep = (key: string, value: string) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // a browser keeping nothing still puts the emoji in; it is only not remembered
    }
};

/** How many emoji a row of the grid holds (quire-extras.css). */
const ACROSS = 8;

/** The emoji grid, for a menu to hold: `put` is told each emoji chosen, and the grid stays open for more. */
export function emojiGrid(put: (name: string, tone: number) => void): HTMLElement {
    const box = make("div", "quire-specials quire-emoji");
    const top = make("div", "quire-emoji-top");
    const search = make("input", "quire-specials-search");
    search.type = "search";
    search.placeholder = "Search, as in heart or cat";
    search.setAttribute("aria-label", "Search the emoji");
    search.spellcheck = false;
    let tone = Number(kept(TONE_KEY)) || 0;
    if (!(tone >= 0 && tone <= 5)) tone = 0;
    const toneButton = make("button", "quire-special quire-emoji-tone", toned("raised_hand", tone));
    toneButton.type = "button";
    toneButton.title = "Skin tone";
    toneButton.setAttribute("aria-label", "Skin tone");
    toneButton.setAttribute("aria-expanded", "false");
    top.append(search, toneButton);
    // the tones open under the search in place, growing, for the hand or for an emoji held down
    const tones = make("div", "quire-emoji-tones");
    const tonesInner = make("div", "quire-specials-grid");
    tones.append(tonesInner);
    const tabs = make("div", "quire-emoji-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Groups");
    const label = make("p", "quire-specials-group");
    const grid = make("div", "quire-specials-grid");
    const scroller = make("div", "quire-specials-groups");
    scroller.append(label, grid);
    box.append(top, tones, tabs, scroller);

    const groups = grouped();
    let lately = readUsed(kept(USED_KEY));
    let group = lately.length ? "used" : GROUPS[0]!.key;

    const choose = (name: string, as: number) => {
        put(name, as);
        lately = used(lately, { name, tone: TONED.has(name) ? as : 0 });
        keep(USED_KEY, JSON.stringify(lately));
    };
    /** A button for an emoji in the grid: pressed it is put in, held down its tones open. */
    const button = (name: string, as: number, run?: () => void) => {
        const each = make("button", "quire-special", toned(name, as));
        each.type = "button";
        each.title = name.replace(/_/g, " ");
        each.setAttribute("aria-label", each.title);
        each.addEventListener("mousedown", (event) => event.preventDefault());
        let held: ReturnType<typeof setTimeout> | undefined;
        let opened = false;
        if (TONED.has(name) && !run) {
            each.addEventListener("pointerdown", () => {
                opened = false;
                held = setTimeout(() => ((opened = true), showTones(name)), 500);
            });
            for (const end of ["pointerup", "pointerleave", "pointercancel"]) each.addEventListener(end, () => clearTimeout(held));
            // a long press on a touch screen would open the browser's own menu
            each.addEventListener("contextmenu", (event) => event.preventDefault());
        }
        each.addEventListener("click", () => {
            if (opened) return void (opened = false);
            (run ?? (() => choose(name, as)))();
        });
        return each;
    };

    /** Opens the row of tones: of the hand, to set the tone the grid uses, or of an emoji held down, to put it in one. */
    function showTones(name?: string) {
        const open = !tones.classList.contains("open") || tones.dataset.name !== (name ?? "");
        tones.dataset.name = name ?? "";
        tones.classList.toggle("open", open);
        toneButton.setAttribute("aria-expanded", String(open && !name));
        if (!open) return;
        tonesInner.replaceChildren(
            ...[0, 1, 2, 3, 4, 5].map((each) => {
                const pick = button(name ?? "raised_hand", each, () => {
                    tone = each;
                    keep(TONE_KEY, String(tone));
                    toneButton.textContent = toned("raised_hand", tone);
                    tones.classList.remove("open");
                    toneButton.setAttribute("aria-expanded", "false");
                    if (name) choose(name, each);
                    fill();
                    (name ? grid.querySelector<HTMLElement>(".quire-special") : toneButton)?.focus({ preventScroll: true });
                });
                pick.classList.toggle("pressed", each === tone);
                pick.title = ["No skin tone", "Light skin tone", "Medium-light skin tone", "Medium skin tone", "Medium-dark skin tone", "Dark skin tone"][each]!;
                pick.setAttribute("aria-label", pick.title);
                return pick;
            }),
        );
        tonesInner.querySelector<HTMLElement>(".pressed")?.focus({ preventScroll: true });
    }
    toneButton.addEventListener("mousedown", (event) => event.preventDefault());
    toneButton.addEventListener("click", () => showTones());

    const tabFor = (key: string, sign: string, name: string) => {
        const tab = make("button", "quire-special quire-emoji-tab", sign);
        tab.type = "button";
        tab.title = name;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-label", name);
        tab.dataset.group = key;
        tab.addEventListener("mousedown", (event) => event.preventDefault());
        tab.addEventListener("click", () => {
            group = key;
            search.value = "";
            fill();
        });
        return tab;
    };
    const drawTabs = () => tabs.replaceChildren(...(lately.length ? [tabFor("used", "\u{1F552}", "Recently used")] : []), ...GROUPS.map((each) => tabFor(each.key, each.sign, each.label)));

    function fill() {
        const query = search.value.trim();
        const shown: Used[] = query ? matchEmoji(query, Infinity).map((each) => ({ name: each.name, tone })) : group === "used" ? lately : (groups.get(group) ?? []).map((name) => ({ name, tone }));
        label.textContent = query ? (shown.length ? "Found" : "Nothing by that name") : group === "used" ? "Recently used" : (GROUPS.find((each) => each.key === group)?.label ?? "");
        grid.replaceChildren(...shown.map((each) => button(each.name, each.tone)));
        for (const tab of tabs.children) {
            const on = !query && (tab as HTMLElement).dataset.group === group;
            tab.classList.toggle("pressed", on);
            tab.setAttribute("aria-selected", String(on));
        }
        scroller.scrollTop = 0;
    }
    search.addEventListener("input", fill);

    // the arrows move through the grid by rows and columns, up out of its first row to the tabs and the search, and along the tabs
    box.addEventListener("keydown", (event) => {
        if (composing(event)) return;
        const at = document.activeElement as HTMLElement;
        const cells = [...grid.children] as HTMLElement[];
        const index = cells.indexOf(at);
        const go = (to: HTMLElement | undefined) => {
            if (!to) return;
            event.preventDefault();
            event.stopPropagation();
            to.focus({ preventScroll: true });
            to.scrollIntoView({ block: "nearest" });
        };
        if (at === search) {
            if (event.key === "Enter") {
                event.preventDefault();
                const first = cells[0];
                if (first) first.click();
            } else if (event.key === "ArrowDown") go(tabs.querySelector<HTMLElement>(".pressed") ?? cells[0]);
            return;
        }
        if (at.parentElement === tabs) {
            const all = [...tabs.children] as HTMLElement[];
            const side = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (side) {
                const next = all[(all.indexOf(at) + side + all.length) % all.length];
                go(next);
                next?.click();
            } else if (event.key === "ArrowDown") go(cells[0]);
            else if (event.key === "ArrowUp") go(search);
            return;
        }
        if (at.parentElement === tonesInner) {
            const all = [...tonesInner.children] as HTMLElement[];
            const side = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
            if (side) go(all[Math.min(all.length - 1, Math.max(0, all.indexOf(at) + side))]);
            else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                showTones(tones.dataset.name || undefined);
                (tones.dataset.name ? cells.find((cell) => cell.title === tones.dataset.name!.replace(/_/g, " ")) : toneButton)?.focus();
            }
            return;
        }
        if (at === toneButton) {
            if (event.key === "ArrowLeft") go(search);
            else if (event.key === "ArrowDown") go(tones.classList.contains("open") ? (tonesInner.firstElementChild as HTMLElement) : (tabs.querySelector<HTMLElement>(".pressed") ?? undefined));
            return;
        }
        if (index < 0) return;
        const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: ACROSS, ArrowUp: -ACROSS }[event.key];
        if (step === undefined) return;
        if (index + step < 0) return go(tabs.querySelector<HTMLElement>(".pressed") ?? search);
        go(cells[Math.min(cells.length - 1, index + step)]);
    });
    drawTabs();
    fill();
    return box;
}

/** Opens the grid where the cursor is, from a key: a menu growing out of the cursor, giving the caret back on Escape. */
export function emojiAtCursor(surface: Surface): () => void {
    const anchor = make("span", "quire-anchor");
    anchor.setAttribute("aria-hidden", "true");
    document.body.append(anchor);
    const menu = flowMenu("Emoji", { className: "quire-emoji-menu" });
    return () => {
        if (menu.isOpen()) return menu.close(true);
        const selection = getSelection();
        const rect = selection?.rangeCount && surface.element.contains(selection.anchorNode) ? selection.getRangeAt(0).getBoundingClientRect() : surface.element.getBoundingClientRect();
        if (rect.width || rect.height) Object.assign(anchor.style, { left: `${rect.left}px`, top: `${rect.top}px`, height: `${Math.max(rect.height, 16)}px` });
        menu.open(anchor, emojiGrid(putter(surface)), true);
    };
}

/** What the grid does with an emoji chosen: puts it in at the cursor, one undo step each. */
export const putter = (surface: Surface) => (name: string, tone: number) => surface.run((doc, selection) => putEmoji({ doc, selection }, name, tone), "type");
