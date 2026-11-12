// Runs the real speech models end to end in headless Chromium, on the built site served with its
// headers (`bun run build`, then a server that applies public/_headers on port 4401). Chromium is
// started with a fake microphone that plays a spoken WAV file once; for each model it downloads
// the files (cold start), listens to the file until dictation switches itself off, then loads
// again from the browser's storage (warm start) and listens again. It prints what was written, the
// word error against the known text, the times, the real-time factor, the delay before a live
// word appears, how long a key pressed while dictating takes to reach the screen, the memory in
// use, and how smoothly the page drew while the model worked.
//
//   bun scripts/dictation-check.ts <wav> <known text file> <tier>...      tiers: main light tiny
//
// Environment: PORT is the server's port (4401); WORDS is a JSON file of the words with their end
// times in seconds ([{ "t": "The", "e": 0.4 }, ...], from a whole-file run), which turns on the
// delay measure; GPU=1 gives Chromium the flags for the real graphics card (the integrated one
// if VK_ICD_FILENAMES names it). It downloads the models from Hugging Face the first time, which is
// expected.

import { spawnSync } from "node:child_process";
import { browser } from "./browser";

const [wav, known, ...tiers] = Bun.argv.slice(2);
if (!wav || !known || tiers.length === 0) throw new Error("usage: bun scripts/dictation-check.ts <wav> <known text file> <tier>...");
const PAGE = `http://localhost:${process.env.PORT ?? 4401}/mdquire-dictation/`;
const GPU = process.env.GPU ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan"] : [];
const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);

/** Words that are wrong, missing or extra, over the words that should be there. */
function wordErrors(want: string[], got: string[]): number {
    const grid = Array.from({ length: want.length + 1 }, (_, row) => [row, ...Array<number>(got.length).fill(0)]);
    for (let column = 0; column <= got.length; column++) grid[0]![column] = column;
    for (let row = 1; row <= want.length; row++) for (let column = 1; column <= got.length; column++) grid[row]![column] = Math.min(grid[row - 1]![column]! + 1, grid[row]![column - 1]! + 1, grid[row - 1]![column - 1]! + (want[row - 1] === got[column - 1] ? 0 : 1));
    return grid[want.length]![got.length]!;
}

/** Resident memory of everything the browser has running, in megabytes. */
const memory = (): number => {
    const listed = spawnSync("ps", ["-eo", "rss,args"], { encoding: "utf8" }).stdout.split("\n").filter((line) => line.includes("site-browser-"));
    return Math.round(listed.reduce((sum, line) => sum + Number(line.trim().split(/\s+/)[0]), 0) / 1024);
};

const percentile = (values: number[], share: number) => (values.length === 0 ? null : [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * share))]);

/**
 * How late each live word came. The page records every change of the faint words with the time;
 * a phrase's words are counted from the last time the faint words were empty, and the nth word of
 * the nth phrase is the one that ends at `ends[index]` seconds into the sound.
 */
function delays(trace: [number, string][], start: number, ends: number[], phraseLengths: number[]): number[] {
    const seen = new Map<number, number>();
    let phrase = 0;
    let before = "";
    for (const [time, text] of trace) {
        if (before !== "" && text === "") phrase++;
        before = text;
        const count = words(text).length;
        const offset = phraseLengths.slice(0, phrase).reduce((sum, each) => sum + each, 0);
        for (let at = 0; at < count; at++) if (!seen.has(offset + at)) seen.set(offset + at, time);
    }
    return [...seen].filter(([index]) => ends[index] !== undefined).map(([index, time]) => (time - start) / 1000 - ends[index]!);
}

const wanted = (await Bun.file(known).text()).trim();
const reference = process.env.WORDS ? ((await Bun.file(process.env.WORDS).json()) as { t: string; e: number }[]) : undefined;
// the sentences of the known text, which are the phrases the pauses in the sound make
const phrases = wanted.split(/(?<=[.!?])\s+/).map((each) => words(each).length);
for (const tier of tiers) {
    const tab = await browser({ width: 1300, height: 800, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}%noloop`, "--autoplay-policy=no-user-gesture-required", ...GPU] });
    const result: Record<string, unknown> = { tier, baselineMB: memory() };
    try {
        await tab.open(PAGE, 500);
        await tab.run(`localStorage.clear(); localStorage.setItem('mdquire-dictation-tier', '${tier}')`);
        for (const run of ["cold", "warm"]) {
            await tab.open(PAGE, 800);
            // how smoothly the page draws while the model works, when the faint words change, and how long keys take to reach the screen
            await tab.run(`window.gaps = []; window.trace = []; window.keys = []; window.began = 0;
                let last = performance.now(); const tick = (now) => { window.gaps.push(now - last); last = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
                let faint = ''; setInterval(() => { const text = document.querySelector('.quire-ghost')?.textContent ?? ''; if (text !== faint) { window.trace.push([performance.now(), text]); faint = text; } if (!window.began && window.dictation.state() === 'listening') window.began = performance.now(); }, 10);
                addEventListener('keydown', (event) => { const at = event.timeStamp; requestAnimationFrame(() => { const channel = new MessageChannel(); channel.port1.onmessage = () => window.keys.push(performance.now() - at); channel.port2.postMessage(0); }); }, true);`);
            const began = Date.now();
            const before = memory();
            await tab.run(`document.querySelector('[aria-label^="Start dictation"]').click()`);
            if (run === "cold") {
                for (let waited = 0; waited < 600 && !(await tab.run<boolean>(`!!document.querySelector('.quire-dictation-action.primary')`)); waited++) await tab.wait(100);
                await tab.run(`document.querySelector('.quire-dictation-action.primary').click()`);
            }
            let ready = 0;
            for (let waited = 0; waited < 5400; waited++) {
                const now = await tab.run<string>("window.dictation.state()");
                if (now === "listening") {
                    ready = Date.now() - began;
                    break;
                }
                if (now === "off" && Date.now() - began > 3000) throw new Error(`stopped before listening: ${await tab.run<string>("window.dictation.stats().message")}`);
                await tab.wait(1000);
            }
            const during = memory();
            // a key pressed every third of a second while the words are being heard (Alt+Q does nothing in the editor)
            for (let waited = 0; waited < 300 && (await tab.run<string>("window.dictation.state()")) !== "off"; waited++) {
                await tab.press("q", { alt: true });
                await tab.wait(330);
            }
            const stats = await tab.run<{ backend: string; loadMs: number; speed: number; mode: string; message: string }>("window.dictation.stats()");
            const text = await tab.run<string>("window.dictationDoc()");
            const gaps = (await tab.run<number[]>("window.gaps")).slice(5);
            const keys = await tab.run<number[]>("window.keys");
            const trace = await tab.run<[number, string][]>("window.trace");
            const start = await tab.run<number>("window.began");
            const errors = wordErrors(words(wanted), words(text));
            const late = reference ? delays(trace, start, reference.map((word) => word.e), phrases) : [];
            result[run] = {
                ready: `${(ready / 1000).toFixed(1)} s`,
                loaded: `${(stats.loadMs / 1000).toFixed(1)} s`,
                backend: stats.backend,
                speed: stats.speed ? `${stats.speed.toFixed(2)} (recognizing time over sound time)` : "not measured",
                mode: stats.mode,
                note: stats.message || undefined,
                wer: `${((100 * errors) / words(wanted).length).toFixed(1)} % (${errors} of ${words(wanted).length})`,
                text,
                liveWordDelaySeconds: late.length ? { words: late.length, median: +percentile(late, 0.5)!.toFixed(2), p90: +percentile(late, 0.9)!.toFixed(2) } : "not measured",
                keyToPaintMs: keys.length ? { keys: keys.length, median: +percentile(keys, 0.5)!.toFixed(1), max: +Math.max(...keys).toFixed(1) } : "not measured",
                memoryBeforeMB: before, memoryWhileListeningMB: during,
                longestFrameMs: Math.round(Math.max(...gaps)),
                framesOver33ms: gaps.filter((gap) => gap > 33).length,
                framesTotal: gaps.length,
            };
            // the model is let go a little after dictation stops
            await tab.wait(36000);
            (result[run] as Record<string, unknown>).memoryAfterReleaseMB = memory();
            if (tab.errors.length) (result[run] as Record<string, unknown>).errors = [...tab.errors];
        }
    } catch (error) {
        result.failed = error instanceof Error ? error.message : String(error);
    }
    console.log(JSON.stringify(result, null, 2));
    await tab.close();
}
process.exit(0);
