// What the converter's page is held to: its right-click menu and the line under the list; and in
// Chromium with imgQuire's real encoders (served from the site's own files), pictures dropped, chosen,
// pasted and pasted from the menu each become a row, convert a few at a time to the format and size
// chosen with their own names and a number for a second of one name, a picture stopped stays stopped,
// a file of no kind the converter knows says so, one result saves alone, all leave as one zip that
// reads back, and nothing is fetched but the page's own files.

import { expect, test } from "bun:test";
import { corePage, quire } from "../../../scripts/core-page";
import { readZip } from "../core/zip";
import { menuLines, summaryOf } from "./page";

const PUBLIC = `${import.meta.dir}/../../../public`;

/** Every address but this machine's own, for `serve` to refuse: the page's own files come from the test's server. */
export const ELSEWHERE = ["https://", ..."abcdefghijkmnpqrstuvwxyz0123456789".split("").map((letter) => `http://${letter}`), ..."abcdefghijklmnpqrstuvwxyz".split("").map((letter) => `http://l${letter}`)];

test("the right-click menu offers what can be done with the file pressed, then Paste and Choose files", () => {
    const run = { save() {}, copy() {}, stop() {}, again() {}, remove() {}, paste() {}, choose() {} };
    expect(menuLines(undefined, run).map((each) => each.label)).toEqual(["Paste", "Choose files"]);
    expect(menuLines({ state: "done", text: true }, run).map((each) => each.label || "-")).toEqual(["Save", "Copy", "Convert again", "Remove", "-", "Paste", "Choose files"]);
    expect(menuLines({ state: "running", text: false }, run).map((each) => each.label || "-")).toEqual(["Stop", "Remove", "-", "Paste", "Choose files"]);
    expect(menuLines({ state: "failed", text: false }, run).map((each) => each.label || "-")).toEqual(["Try again", "Remove", "-", "Paste", "Choose files"]);
});

test("the line under the list counts the files, those done and what they weigh before and after", () => {
    expect(summaryOf([])).toBe("");
    expect(summaryOf([{ state: "ready", before: 1000 }])).toBe("1 file");
    expect(summaryOf([{ state: "done", before: 3_400_000, after: 410_000 }, { state: "done", before: 600_000, after: 90_000 }, { state: "running", before: 5 }])).toBe("3 files · 2 done · 4.0 MB to 500 KB · 1 working");
});

/** A page with the converter and its sides, as the site's script builds it, served with the codecs and the worker. */
export async function convertPage(sides: string, extra = "") {
    const built = await Bun.build({ entrypoints: [`${quire}/img/codec-run.ts`], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const worker = await built.outputs[0]!.text();
    const css = await Bun.file(`${import.meta.dir}/../../styles/quire-convert.css`).text();
    return corePage(
        `
        import { createConvertPage } from "${quire}/convert/page.ts";
        import { pictureSide } from "${quire}/convert/picture-side.ts";
        import { decodeHeic, heicIn } from "${quire}/img/codec-run.ts";
        import { FORMATS, formatOf, underWeight } from "${quire}/img/export.ts";
        import { blocksOut } from "${quire}/img/metadata.ts";
        ${extra}
        window.pictures = {
            formats: FORMATS.map(({ key, label, short, tip, type, ending, lossy }) => ({ key, label, short, tip, type, ending, lossy })),
            async encode(pixels, settings, meta, tried) {
                const format = formatOf(settings.format);
                const encode = async (quality) => { const blob = await format.encode(pixels, quality, meta); tried(); return blob; };
                if (format.lossy && settings.target) return underWeight(encode, settings.target);
                return { blob: await encode(settings.quality), quality: settings.quality, over: false };
            },
            metadata: (original, keep) => blocksOut(original, keep, {}),
            isHeic: heicIn,
            decodeHeic,
        };
        window.downloads = {};
        HTMLAnchorElement.prototype.click = function () { if (this.download) fetch(this.href).then((answer) => answer.arrayBuffer()).then((buffer) => (window.downloads[this.download] = new Uint8Array(buffer))); };
        window.copied = [];
        navigator.clipboard.writeText = async (text) => window.copied.push(text);
        window.clipboardItems = [];
        navigator.clipboard.read = async () => window.clipboardItems;
        // a picture made in code: a gradient, a disc and a block, at a size, as PNG or JPEG
        window.picture = async (width, height, name, type = "image/png") => {
            const canvas = new OffscreenCanvas(width, height);
            const c = canvas.getContext("2d");
            const fade = c.createLinearGradient(0, 0, width, height); fade.addColorStop(0, "#3060c0"); fade.addColorStop(1, "#f0b040");
            c.fillStyle = fade; c.fillRect(0, 0, width, height);
            c.fillStyle = "#c02040"; c.beginPath(); c.arc(width * 0.3, height * 0.45, height * 0.25, 0, 7); c.fill();
            return new File([await canvas.convertToBlob({ type, quality: 0.92 })], name, { type });
        };
        window.convert = createConvertPage(document.querySelector("#host"), ${sides});
    `,
        {
            body: `<style>${css}</style><div id="host"></div>`,
            width: 1300,
            height: 900,
            files: async (path) => {
                if (path === "/codec-run.ts") return new Response(worker, { headers: { "Content-Type": "text/javascript" } });
                if (path.startsWith("/quire/codecs/") && !path.includes("..")) {
                    const file = Bun.file(`${PUBLIC}${path}`);
                    if (await file.exists()) return new Response(file, { headers: { "Content-Type": "application/wasm" } });
                }
                return undefined;
            },
        },
    );
}

test("in Chromium, pictures arrive four ways, convert with their own names to the size chosen, stop, save alone and as a zip, fetching nothing else", async () => {
    const page = await convertPage("[pictureSide(window.pictures)]");
    if (!page) return console.warn("converter page test skipped: needs a Chromium");
    const { tab } = page;
    const until = async (expression: string, ms = 60_000) => {
        const started = Date.now();
        while (Date.now() - started < ms) {
            if (await tab.run<boolean>(`!!(${expression})`)) return;
            await tab.wait(80);
        }
        throw new Error(`waited for ${expression}: ${JSON.stringify(await tab.run("window.convert.rows()"))}`);
    };
    const pressText = async (text: string) => {
        const at = await tab.run<{ x: number; y: number }>(`(() => { const e = [...document.querySelectorAll('.quire-convert button')].find((each) => each.textContent.trim() === ${JSON.stringify(text)} && !each.closest('[inert]')); e.scrollIntoView({ block: "center", behavior: "instant" }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
        await tab.click(at.x, at.y);
    };
    try {
        await tab.serve(ELSEWHERE, async () => undefined);
        // a drop of two pictures of one name and a file of no known kind
        await tab.run(`(async () => {
            const data = new DataTransfer();
            data.items.add(await window.picture(640, 480, "photo.png"));
            data.items.add(await window.picture(800, 400, "photo.jpg", "image/jpeg"));
            data.items.add(new File([new Uint8Array([0, 1, 2, 3, 250, 251])], "blob.bin"));
            const root = document.querySelector(".quire-convert");
            root.dispatchEvent(new DragEvent("dragover", { dataTransfer: data, bubbles: true, cancelable: true }));
            root.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
        })()`);
        await until("window.convert.rows().length === 3 && window.convert.rows().every((row) => row.state !== 'ready' || row.label)");
        const rows = await tab.run<{ name: string; kind: string; state: string; notes: string[] }[]>("window.convert.rows()");
        expect(rows.map((row) => [row.name, row.kind])).toEqual([["photo.png", "picture"], ["photo.jpg", "picture"], ["blob.bin", "unknown"]]);
        expect(rows[2]!.state).toBe("cannot");
        expect(rows[2]!.notes).toEqual(["This is not a kind of file the converter knows."]);
        // a paste and Paste from the menu
        await tab.run(`(async () => {
            const data = new DataTransfer();
            data.items.add(await window.picture(300, 300, "screenshot.png"));
            document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
            const blob = await window.picture(200, 100, "x.png");
            window.clipboardItems = [{ types: ["image/png"], getType: async () => blob }];
        })()`);
        await until("window.convert.rows().length === 4");
        const workAt = await tab.run<{ x: number; y: number }>("(() => { const b = document.querySelector('.quire-convert-drop').getBoundingClientRect(); return { x: b.x + 20, y: b.y + 20 }; })()");
        await tab.run(`document.querySelector('.quire-convert-drop').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${workAt.x}, clientY: ${workAt.y} }))`);
        await until("document.querySelector('.quire-menu:popover-open')");
        await tab.run("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-items button')].find((each) => each.textContent.includes('Paste')).click()");
        await until("window.convert.rows().length === 5");
        expect(await tab.run<string>("window.convert.rows()[4].name")).toBe("Pasted picture.png");
        // choose a largest side of 256 and convert all
        await pressText("Largest side");
        await tab.run("(() => { const input = document.querySelector('.quire-convert-fold.open input[type=number]'); input.value = '256'; input.dispatchEvent(new Event('change')); })()");
        expect(await tab.run<string>("document.querySelector('.quire-convert-row .quire-convert-becomes').textContent")).toBe("to WebP, 256 px at most");
        await pressText("Convert");
        await until("window.convert.rows().filter((row) => row.state === 'done').length === 4", 120_000);
        const done = await tab.run<{ name: string; status: string; made: { name: string; facts: string; blob: unknown } }[]>("window.convert.rows().filter((row) => row.made)");
        expect(done.map((row) => row.made.name)).toEqual(["photo.webp", "photo (1).webp", "screenshot.webp", "Pasted picture.webp"]);
        expect(done.map((row) => row.made.facts)).toEqual(["640 × 480 to 256 × 192", "800 × 400 to 256 × 128", "300 × 300 to 256 × 256", "200 × 100"]);
        expect(await tab.run<string>("document.querySelector('.quire-convert-summary').textContent")).toMatch(/^5 files · 4 done · [\d.]+ KB to [\d.]+ KB$/);
        // one saved alone, then all as a zip that reads back with the four in it
        await tab.run("document.querySelector('.quire-convert-row[data-state=done] .quire-convert-row-main').click()");
        await until("window.downloads['photo.webp']");
        await pressText("Save all as a zip");
        await until("window.downloads['converted.zip']");
        const zip = await tab.run<number[]>("[...window.downloads['converted.zip']]");
        const inside = await readZip(new Uint8Array(zip));
        expect([...inside.keys()]).toEqual(["photo.webp", "photo (1).webp", "screenshot.webp", "Pasted picture.webp"]);
        for (const bytes of inside.values()) expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WEBP");
        // a large picture as AVIF, stopped while it is written, stays stopped
        await pressText("AVIF");
        await tab.run("(async () => window.convert.add(await window.picture(3000, 2000, 'big.png'), 'big.png'))()");
        await until("window.convert.rows().length === 6");
        await pressText("Convert");
        await until("window.convert.rows()[5].state === 'running'");
        await tab.run("document.querySelector('.quire-convert-row:last-child .quire-convert-row-main').click()");
        expect(await tab.run<string>("window.convert.rows()[5].state")).toBe("stopped");
        await tab.wait(1500);
        expect(await tab.run<string>("window.convert.rows()[5].state")).toBe("stopped");
        // nothing was fetched but the page's own codec files and worker
        const away = tab.requests.filter((request) => !/^http:\/\/localhost:\d+\/(quire\/codecs\/[a-z]+\.wasm|codec-run\.ts|page\.html)?$/.test(request.url) && !request.url.startsWith("blob:") && !request.url.startsWith("data:"));
        expect(away).toEqual([]);
        expect(tab.errors).toEqual([]);
    } finally {
        await page.close();
    }
}, 240_000);
