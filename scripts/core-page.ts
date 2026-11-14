// A page holding a script of the Quires' core, bundled with the site's styles and opened in headless
// Chromium, for the browser tests of the core's pieces (the frame, the session, the status) and of a
// kind of document on the app. The script is the test's own, importing from src/quire/.
//
//   const page = await corePage(`import { createFrame } from "${quire}/core/frame.ts"; ...`);
//   if (page) try { await page.tab.run("..."); } finally { await page.close(); }

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser, chromium, type Browser } from "./browser";
import { withoutSpeech } from "./dictation-stubs";

/** The folder of the Quires, for a test's script to import from. */
export const quire = `${import.meta.dir}/../src/quire`;
const styles = `${import.meta.dir}/../src/styles`;

/** A page opened on a script. */
export interface CorePage {
    tab: Browser;
    close(): Promise<void>;
}

/** Builds a page on a script and opens it, or gives undefined where there is no Chromium. `body` is the page's HTML before the script; `args` go to Chromium (WebGPU wants `--enable-unsafe-webgpu` headless). */
export async function corePage(script: string, options: { body?: string; width?: number; height?: number; args?: string[] } = {}): Promise<CorePage | undefined> {
    if (!chromium()) return undefined;
    const folder = await mkdtemp(join(tmpdir(), "quire-core-"));
    try {
        await Bun.write(`${folder}/page.ts`, script);
        const built = await Bun.build({ entrypoints: [`${folder}/page.ts`], target: "browser", plugins: [withoutSpeech] });
        if (!built.success) throw new Error(built.logs.join("\n"));
        const theme = ":root{--ground:oklch(0.16 0.035 300);--surface:oklch(0.21 0.045 300);--rule:oklch(0.32 0.055 300);--ink:oklch(0.93 0.02 300);--muted:oklch(0.73 0.045 300);--accent:oklch(0.77 0.16 300)}";
        const css = (await Promise.all(["tokens.css", "base.css", "prose.css", "quire.css", "quire-markdown.css", "quire-extras.css", "quire-img.css"].map((name) => Bun.file(`${styles}/${name}`).text()))).join("\n");
        await Bun.write(`${folder}/page.html`, `<!doctype html><meta charset="utf-8"><style>${css}${theme}</style><body class="quire-app">${options.body ?? '<div id="host" class="quire-host"></div>'}<script type="module">${await built.outputs[0]!.text()}</script></body>`);
        const tab = await browser({ width: options.width ?? 1300, height: options.height ?? 800, args: options.args });
        try {
            await tab.open(`file://${folder}/page.html`, 300);
        } catch (error) {
            await tab.close();
            throw error;
        }
        return {
            tab,
            async close() {
                await tab.close();
                await rm(folder, { recursive: true, force: true });
            },
        };
    } catch (error) {
        // a page that could not be built or opened leaves no folder behind
        await rm(folder, { recursive: true, force: true });
        throw error;
    }
}
