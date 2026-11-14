// How mdQuire shows a version in the core's history panel (core/versions.ts): the snapshot read as
// the editor opens a document, drawn as the editor draws it and not editable, with the blocks it
// added since the version before tinted; and restored as one step that can be undone.

import type { Document } from "./document";
import { opened } from "./quire-parts";
import { createSurface, type Surface } from "./surface";
import { snapshotParts, type VersionView } from "../core/versions";

/** The document a snapshot holds, read as the editor opens a document; a Markdown snapshot of a `.quire` document keeps the page it is restored into. */
export function snapshotDocument(saved: string, into: Document): Document {
    const { markdown, parts } = snapshotParts(saved);
    if (parts) return opened(markdown, parts);
    const doc = opened(markdown, undefined, { mdx: into.mdx });
    return into.quire ? { ...doc, quire: into.quire } : doc;
}

/** Which of a version's top blocks are new since the one before it: those whose Markdown the one before does not have (as many times). */
export function addedBlocks(before: Document | undefined, after: Document): number[] {
    const markdown = (block: Document["blocks"][number]) => (block.source ?? JSON.stringify({ ...block, gap: "" })).trim();
    const left = new Map<string, number>();
    for (const block of before?.blocks ?? []) left.set(markdown(block), (left.get(markdown(block)) ?? 0) + 1);
    const added: number[] = [];
    after.blocks.forEach((block, index) => {
        const had = left.get(markdown(block)) ?? 0;
        if (had > 0) left.set(markdown(block), had - 1);
        else if (markdown(block)) added.push(index);
    });
    return added;
}

// ---- thinning ----

/** The history panel's view of versions for a surface. */
export function versionView(surface: Surface): VersionView {
    return {
        show(text, older, into) {
            const before = older !== undefined ? snapshotDocument(older, surface.getDocument()) : undefined;
            // the version as it read, styling and all, drawn as the editor draws it, and not editable; what it added since the one before is tinted
            const doc = snapshotDocument(text, surface.getDocument());
            const view = createSurface(into, doc);
            for (const index of addedBlocks(before, doc)) view.elementAt([index])?.classList.add("quire-history-added");
            view.destroy();
            into.removeAttribute("role");
        },
        restore: (text) => surface.run(() => snapshotDocument(text, surface.getDocument())),
        focus: () => surface.focus(),
    };
}
