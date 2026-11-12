// The whole editor: the bar, the writing column with the surface in it, and everything around it,
// put together on one element. The page that shows mdQuire calls createEditor and nothing else.
//
//   const editor = createEditor(element, read(text), { name: "post", onImage, colors });
//   editor.surface              the editing surface (surface.ts)
//   editor.getName(), editor.destroy()

import { read } from "./read";
import { createBar, link as linkAction } from "./bar";
import { linkAt } from "./bar";
import { type Document } from "./document";
import { collapsed } from "./keys";
import { createSurface, type Surface } from "./surface";
import { flowMenu, linkForm, make, type MenuItem } from "./ui";
import { write } from "./write";

/** What the editor is given by the page. */
export interface EditorOptions {
    /** The document's name, shown in the bar and used for downloads. */
    name: string;
    /** Stores a pasted, dropped or chosen picture and gives back its address. */
    onImage?: (file: File) => Promise<string>;
    /** The colors offered for text. */
    colors?: { name: string; value: string }[];
    onRename?: (name: string) => void;
}

/** The editor, as the page sees it. */
export interface Editor {
    surface: Surface;
    getName(): string;
    destroy(): void;
}

/** Builds the editor on an element. */
export function createEditor(host: HTMLElement, doc: Document, options: EditorOptions): Editor {
    host.classList.add("quire-editor");
    let name = options.name;
    const column = make("div", "quire-column");
    const paper = make("div", "quire-paper");
    const text = make("div", "prose");
    text.setAttribute("aria-label", "Document");
    paper.append(text);
    host.append(column);
    const surface = createSurface(text, doc, { onImage: options.onImage });

    // ---- the link field, from the bar's button or Ctrl+K ----
    const links = flowMenu("Link");
    const openLink = (from: HTMLElement) => {
        if (links.isOpen()) return links.close(true);
        const selection = surface.getSelection();
        const current = linkAt(surface.getDocument(), collapsed(selection) ? selection.focus : selection.anchor);
        const finish = () => {
            links.close(false);
            surface.focus();
        };
        const form = linkForm(current?.href, {
            set: (href) => {
                surface.run((d) => linkAction(href)({ doc: d, selection }).doc);
                finish();
            },
            remove: () => {
                surface.run((d) => linkAction(null)({ doc: d, selection }).doc);
                finish();
            },
            cancel: finish,
        });
        links.open(from, form);
        form.querySelector("input")?.focus({ preventScroll: true });
    };

    // ---- the three-dot menu ----
    const download = () => {
        const text = write(surface.getDocument());
        const file = new Blob([text], { type: "text/markdown" });
        const anchor = make("a");
        anchor.href = URL.createObjectURL(file);
        anchor.download = `${name}.${surface.getDocument().mdx ? "mdx" : "md"}`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
    };
    const opener = make("input", "quire-file");
    opener.type = "file";
    opener.accept = ".md,.mdx,.markdown,text/markdown,text/plain";
    opener.tabIndex = -1;
    opener.setAttribute("aria-hidden", "true");
    opener.addEventListener("change", async () => {
        const file = opener.files?.[0];
        opener.value = "";
        if (!file) return;
        const text = await file.text();
        surface.setDocument(read(text, { mdx: file.name.endsWith(".mdx") }));
        name = file.name.replace(/\.(md|mdx|markdown)$/i, "");
        bar.setName(name);
        options.onRename?.(name);
    });
    const more = (): MenuItem[] => [
        { label: "Download", hint: surface.getDocument().mdx ? ".mdx" : ".md", run: download },
        { label: "Open a file", run: () => opener.click() },
    ];

    const bar = createBar(surface, {
        name,
        colors: options.colors,
        onImage: options.onImage,
        onRename: (value) => {
            name = value;
            options.onRename?.(value);
        },
        onLink: openLink,
        more,
    });
    column.append(bar.element, paper, opener);
    surface.on("link", () => openLink(bar.element.querySelector<HTMLElement>('[aria-label^="Link"]')!));

    return {
        surface,
        getName: () => name,
        destroy() {
            surface.destroy();
            for (const menu of [...bar.menus, links]) menu.box.remove();
            host.replaceChildren();
        },
    };
}
