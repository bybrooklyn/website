// The page for mdQuire (src/pages/mdquire.astro): the whole app, with the site's colors for text
// and a sample document holding every kind of block, offered from the welcome the first time.

import { accents } from "../data/theme";
import { css } from "../lib/color";
import { startApp } from "../quire/app";

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

const host = document.querySelector<HTMLElement>("#quire");
const names: Record<string, string> = { violet: "Violet", pink: "Pink", blue: "Blue", mint: "Mint", amber: "Amber" };
const colors = Object.entries(accents).map(([key, value]) => ({ name: names[key] ?? key, value: css(value) }));

if (host) void startApp(host, { colors, sample: SAMPLE, lead: document.querySelector<HTMLElement>(".quire-top") ?? undefined });
