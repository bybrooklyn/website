// The script of the test page for dictation (src/pages/mdquire-dictation.astro): a plain editing
// surface and the dictation control, with nothing of the editor's layout around them. With `?fake`
// in the address it is given a made-up engine and microphone and a `window.dictationTest` to drive
// them, for the browser tests; without it, it is the real thing.

import { documentOf, paragraph } from "../document";
import { write } from "../write";
import { createSurface } from "../surface";
import { createDictation } from "./dictation";
import type { TestControls } from "./fake";

declare global {
    interface Window {
        dictationTest?: TestControls;
        dictation?: ReturnType<typeof createDictation>;
        /** The document as Markdown, for the check that runs the real model. */
        dictationDoc?: () => string;
    }
}

const host = document.querySelector<HTMLElement>("#dictation-host");
if (host) void start(host);

async function start(host: HTMLElement) {
    const fake = new URLSearchParams(location.search).has("fake") ? (await import("./fake")).createFake() : undefined;
    const bar = host.querySelector<HTMLElement>("#dictation-bar")!;
    const paper = host.querySelector<HTMLElement>("#dictation-paper")!;
    const surface = createSurface(paper, documentOf([paragraph()]));
    const dictation = createDictation(surface, { provider: fake?.provider, microphone: fake?.microphone, silence: fake ? 2500 : undefined });
    window.dictation = dictation;
    window.dictationDoc = () => write(surface.getDocument()).trim();
    if (dictation.why) {
        const line = document.createElement("p");
        line.className = "dictation-why";
        line.textContent = dictation.why;
        bar.replaceWith(line);
    } else dictation.mount(bar);
    if (fake) window.dictationTest = { ...fake.controls, markdown: () => write(surface.getDocument()).trim(), provisional: () => document.querySelector(".quire-ghost")?.textContent ?? "" };
    paper.focus();
}
