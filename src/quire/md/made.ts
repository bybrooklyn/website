// What a change to an mdQuire document made, so that the slash menu can open on the writer's own
// five. A thing is counted however it was made (the slash menu, the bar, a menu, its shortcut, or a
// Markdown mark typed such as `* `): the slash menu (slash-menu.ts) compares the document before and
// after each change that makes things and counts what there is more of. The counts are kept by the
// core (core/most-used.ts), in this browser alone.

import { isPageBreak, type Block, type Document, type Run } from "./document";
import { ranked, type Counts } from "../core/most-used";

/** The five the slash menu opens on before anything has been counted, in this order. */
export const FIRST_FIVE = ["heading2", "bullet", "task", "image", "code"];

const LISTS: Record<string, string> = { bullet: "bullet", number: "number", task: "task", definition: "definitions" };

/** Every thing a document holds that the slash menu makes, by key, with how many of each. */
export function tally(doc: Document): Counts {
    const found: Counts = {};
    const add = (key: string) => (found[key] = (found[key] ?? 0) + 1);
    const runs = (list: Run[]) => list.forEach((run) => run.kind === "image" && add("image"));
    const walk = (block: Block): void => {
        if (block.kind === "heading") add(`heading${block.level}`);
        else if (block.kind === "paragraph") (block.subtext && add("subtext"), runs(block.runs));
        else if (block.kind === "list") block.items.forEach((item) => (add(LISTS[block.style]!), item.blocks.forEach(walk)));
        else if (block.kind === "quote") (add(block.callout ? "callout" : block.details ? "details" : "quote"), block.blocks.forEach(walk));
        else if (block.kind === "code") add(block.language === "math" ? "maths" : block.language === "mermaid" ? "diagram" : "code");
        else if (block.kind === "footnote") block.blocks.forEach(walk);
        else if (block.kind === "raw") {
            const tag = /^<(Figure|Terminal|Timeline|PlayHere)\b/.exec(block.text);
            if (isPageBreak(block)) add("pagebreak");
            else if (tag) add(tag[1]!.toLowerCase());
        } else add(block.kind);
    };
    doc.blocks.forEach(walk);
    return found;
}

/** The things there are more of after a change than before it: what the change made. */
export function made(before: Document, after: Document): string[] {
    const was = tally(before);
    return Object.entries(tally(after)).flatMap(([key, count]) => (count > (was[key] ?? 0) ? [key] : []));
}

/** The items as the slash menu opens on them: the first five ahead of the rest, then the most made first. */
export function opening<T extends { key: string }>(items: T[], counts: Counts): T[] {
    const first = FIRST_FIVE.flatMap((key) => items.filter((item) => item.key === key));
    return ranked([...first, ...items.filter((item) => !first.includes(item))], counts);
}
