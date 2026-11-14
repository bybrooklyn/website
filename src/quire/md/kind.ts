// mdQuire as a kind of document for the core's app (core/kind.ts): its documents are Markdown files
// and `.quire` documents, its ways to start are the six the shelf offers (blank, blog post, notes,
// meeting notes, a changelog entry, a project page), and its editor is editor.ts in the core's frame.
// The page gives it what is the site's: the colours offered for text and the sample document.
//
//   startApp(host, { kinds: [markdown({ colors, sample })], top });

import type { Context, Editing, Kind } from "../core/kind";
import { blockPaths, lengthOf } from "./document";
import { createEditor, type Editor } from "./editor";
import { opened } from "./quire-parts";
import { read } from "./read";
import { markdownName, templates } from "./starts";

/** What the page gives mdQuire: the colours offered for text, and a document with every kind of block, offered quietly on the shelf. */
export interface MarkdownOptions {
    colors?: { name: string; value: string }[];
    sample?: string;
}

/** mdQuire, as a kind of document. */
export function markdown(options: MarkdownOptions = {}): Kind {
    return {
        key: "md",
        name: "mdQuire",
        opens: markdownName,
        starts: templates,
        quiet: () => (options.sample ? [{ key: "sample", label: "see a sample", name: "A sample", text: options.sample, quire: true }] : []),
        files: { description: "Markdown and .quire documents", accept: { "text/markdown": [".md", ".mdx", ".markdown", ".txt"], "application/zip": [".quire"] }, chooser: ".md,.mdx,.markdown,.txt,.quire,text/markdown,text/plain" },
        mount: (host, context) => mountEditor(host, context, options),
    };
}

/** Mounts mdQuire's editor in the app, on the document it starts with or on nothing. */
function mountEditor(host: HTMLElement, context: Context, options: MarkdownOptions): Editing & { editor: Editor } {
    const start = context.start;
    const editor = createEditor(host, start ? opened(start.found.text, start.found.quire, { mdx: /\.mdx$/i.test(start.entry.id) }) : read(""), {
        name: start?.entry.name ?? "Untitled",
        store: start?.store,
        id: start?.entry.id,
        mark: start?.found.mark,
        versions: context.versions,
        colors: options.colors,
        top: context.top,
        richHome: context.richHome,
        learnFrom: context.learnFrom,
        fileItems: context.fileItems,
        onOpen: context.onOpen,
        onName: context.onName,
    });
    return {
        // the whole editor, for a page or a test that reaches further in than the app does
        editor,
        paper: editor.paper,
        open: editor.open,
        create: editor.create,
        ready: editor.ready,
        leave: editor.leave,
        flush: editor.flush,
        rename: editor.rename,
        current: editor.current,
        status: editor.status,
        nameElement: editor.nameElement,
        say: editor.say,
        focus: () => editor.surface.focus(),
        // the last line a template starts with stands in for what is written there, and is selected, so that typing takes its place
        started() {
            const paths = blockPaths(editor.surface.getDocument());
            const last = paths[paths.length - 1] ?? [0];
            editor.surface.setSelection({ anchor: { path: last, offset: 0 }, focus: { path: last, offset: lengthOf(editor.surface.getDocument(), last) } });
        },
        destroy: editor.destroy,
    };
}
