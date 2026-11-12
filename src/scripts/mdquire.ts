// The try-out page for mdQuire (src/pages/mdquire.astro): a surface on a sample document that holds
// every kind of block, and the Markdown it writes, shown live beside it when asked for.

import { setLink } from "../quire/document";
import { read } from "../quire/read";
import { createSurface } from "../quire/surface";
import { write } from "../quire/write";

const SAMPLE = `---
title: Every kind of block
---

# A document to type in

A paragraph with *italic*, **bold**, <u>underlined</u>, ~~struck~~ and \`code\` text, a [link](https://example.com), <span style="color:salmon">a color</span>, <span style="font-size:1.4em">a size</span>, and a hard break\\
on the next line.

<div align="center">

A centered line.

</div>

## Lists

- A bullet
- Another, with a nested list
  - inside it
- And a third

1. First
2. Second

- [ ] Something to do
- [x] Something done

> A quotation, with **bold** in it.

\`\`\`ts
const answer = 42;
\`\`\`

| Name | Size |
| :--- | ---: |
| one  | 1    |
| two  | 2    |

---

<Figure src="/assets/playmatter.webp" alt="An MDX component, kept as its source." />

A footnote reference.[^1]

[^1]: And the footnote itself.
`;

const element = document.querySelector<HTMLElement>("#quire-editor");
const shown = document.querySelector<HTMLPreElement>("#quire-markdown");
const toggle = document.querySelector<HTMLInputElement>("#quire-show");

if (element && shown && toggle) {
    const surface = createSurface(element, read(SAMPLE, { mdx: true }), {
        // a picture pasted here is shown from memory; storage comes with the next layer
        onImage: (file) =>
            new Promise((done) => {
                const reader = new FileReader();
                reader.onload = () => done(String(reader.result));
                reader.readAsDataURL(file);
            }),
    });
    const update = () => {
        if (!shown.hidden) shown.textContent = write(surface.getDocument());
    };
    surface.on("change", update);
    surface.on("link", ({ selection }) => {
        const href = window.prompt("Link to");
        if (href === null) return;
        surface.run((doc) => setLink(doc, { start: selection.anchor, end: selection.focus }, href || null));
    });
    toggle.addEventListener("change", () => {
        shown.hidden = !toggle.checked;
        element.parentElement?.classList.toggle("showing", toggle.checked);
        update();
    });
    surface.focus();
}
