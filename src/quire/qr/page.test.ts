// What the QR code page is held to: its menu, each line with a first capital as menus have; its words for a
// code's size and for text too long; and in Chromium, the column built only from the small tools' kit
// (core/bench.ts), its headings in order and every heading, label, choice and word to press in lowercase,
// with no boxed button and what acts on a code faint until there is one; the code changing as a link is
// typed with its square never changing size, read back and said so in the line under it; the keys picking
// a kind, a Wi-Fi login made from its form growing open; text too long said plainly with the last code
// kept; the right-click menu's lines; copy giving the clipboard a PNG and save naming its files by what
// the code holds; a picture in the middle raising the error correction and still reading back; and a
// picture with codes in it read four ways (pasted, dropped, chosen, and paste from the menu), each code
// laid out by its kind as a group of the column. Nothing is fetched from anywhere.

import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { corePage, quire } from "../../../scripts/core-page";
import { encode } from "./encode";
import { lowered } from "../core/bench";
import { factsOf, KINDS, LEVEL_WORDS, qrMenuLines, QR_WORDS, tooLongWords } from "./page";

test("the right-click menu holds Copy, Save as SVG, Save as PNG and Paste a picture to read, each with a first capital as menus have, and only the last with no code", () => {
    const run = { copy() {}, svg() {}, png() {}, paste() {} };
    expect(qrMenuLines({ code: true }, run).map((each) => each.label || "-")).toEqual(["Copy", "Save as SVG", "Save as PNG", "-", "Paste a picture to read"]);
    expect(qrMenuLines({ code: false }, run).map((each) => each.label)).toEqual(["Paste a picture to read"]);
});

test("the words for a code's size and for text too long are plain, and every label of the column is lowercase but for names (PNG, SVG, Wi-Fi)", () => {
    expect(factsOf(encode("hello", { level: "M" }))).toBe("Version 1, 21 by 21 modules, error correction highest.");
    expect(tooLongWords("a".repeat(3000), "M")).toBe("Too long for a QR code: about 3,000 bytes, and one holds at most 2,331 at this error correction. Shorten it, or lower the error correction.");
    expect(KINDS.map((each) => each.key)).toEqual(["1", "2", "3", "4", "5", "6"]);
    for (const label of [...Object.values(QR_WORDS), ...KINDS.map((each) => each.label), ...LEVEL_WORDS.map((each) => each.label)]) expect(label).toBe(lowered(label));
    expect([QR_WORDS.sizes, QR_WORDS.png, QR_WORDS.svg, KINDS[1]!.label]).toEqual(["PNG size", "save PNG", "save SVG", "Wi-Fi"]);
});

test("in Chromium, the page is built from the kit, makes codes as they are typed, styles them, saves them, and reads pictures four ways, fetching nothing", async () => {
    const css = (await Promise.all(["quire-bench.css", "quire-qr.css"].map((name) => Bun.file(`${import.meta.dir}/../../styles/${name}`).text()))).join("\n");
    const folder = await mkdtemp(join(tmpdir(), "quire-qr-page-"));
    const page = await corePage(
        `
        import { createQrPage } from "${quire}/qr/page.ts";
        import { encode } from "${quire}/qr/encode.ts";
        import { drawSvg, PLAIN } from "${quire}/qr/style.ts";
        window.copied = [];
        navigator.clipboard.write = async (items) => { for (const item of items) { const blob = await item.getType("image/png"); const bitmap = await createImageBitmap(blob); window.copied.push({ width: bitmap.width, height: bitmap.height }); } };
        navigator.clipboard.writeText = async (text) => window.copied.push({ text });
        window.downloads = {};
        HTMLAnchorElement.prototype.click = function () { if (this.download) fetch(this.href).then((answer) => answer.text()).then((text) => (window.downloads[this.download] = text.length)); };
        window.clipboardPicture = undefined;
        navigator.clipboard.read = async () => [{ types: ["image/png"], getType: async () => window.clipboardPicture }];
        // a picture of codes drawn by the maker, on a gray ground, the second turned
        window.picture = async (texts, name) => {
            const canvas = new OffscreenCanvas(900, 500);
            const c = canvas.getContext("2d");
            c.fillStyle = "#8a8f99"; c.fillRect(0, 0, 900, 500);
            let at = 40;
            for (const [index, text] of texts.entries()) {
                const svg = drawSvg(encode(text), PLAIN, { size: 360 });
                const image = new Image();
                image.src = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
                await image.decode();
                c.save(); c.translate(at + 180, 250); c.rotate(index * 0.35); c.drawImage(image, -180, -180, 360, 360); c.restore();
                at += 440;
            }
            return new File([await canvas.convertToBlob({ type: "image/png" })], name, { type: "image/png" });
        };
        window.qr = createQrPage(document.querySelector("#host"), { grounds: [{ name: "Mint", value: "#a8f0d0" }] });
    `,
        { body: `<style>${css}</style><div id="host"></div>`, width: 1300, height: 900 },
    );
    if (!page) return;
    const { tab } = page;
    const until = async (expression: string, ms = 20_000) => {
        const started = Date.now();
        while (Date.now() - started < ms) {
            if (await tab.run<boolean>(`!!(${expression})`)) return;
            await tab.wait(60);
        }
        throw new Error(`waited for ${expression}`);
    };
    const centerOf = (expression: string) => tab.run<{ x: number; y: number }>(`(() => { const e = ${expression}; e.scrollIntoView({ block: "center", behavior: "instant" }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    const pressAt = async (expression: string) => {
        const at = await centerOf(expression);
        await tab.click(at.x, at.y);
    };
    const press = (selector: string) => pressAt(`document.querySelector(${JSON.stringify(selector)})`);
    /** A word to press, or a choice's label, by what it says, out of what is out of reach. */
    const pressText = (text: string, within = ".quire-qr") => pressAt(`[...document.querySelectorAll('${within} button, ${within} label')].find((each) => each.textContent.trim() === ${JSON.stringify(text)} && !each.closest('[inert]'))`);
    const verdict = "document.querySelector('.quire-qr-verdict')?.textContent === 'It reads back as written.'";
    try {
        await tab.serve(["http://", "https://"], async () => undefined);
        await tab.wait(200);
        expect(await tab.run<string>("document.querySelector('.quire-qr-code .quire-qr-empty').textContent")).toBe("Type a link or some text, and its code appears here.");
        // the column is the kit's: its headings in order, every label in lowercase, every choice a round dot or a small picture, every
        // field a line to type on, every button a word to press or a color, and what acts on a code there and faint until there is one
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-side .quire-bench-heading')].filter((each) => !each.closest('.quire-qr-read')).map((each) => each.textContent)")).toEqual(["make or read", "what it holds", "shape", "corners", "color", "ground", "margin", "picture", "error correction", "PNG size"]);
        const words = await tab.run<string[]>("[...document.querySelectorAll('.quire-bench-side :is(.quire-bench-heading, .quire-bench-label, .quire-bench-choices label, .quire-bench-press)')].map((each) => each.textContent.trim()).filter(Boolean)");
        expect(words.length).toBeGreaterThan(60);
        expect(words.filter((each) => each !== lowered(each))).toEqual([]);
        expect(await tab.run("[...document.querySelectorAll('.quire-qr button')].filter((each) => !each.matches('.quire-bench-press, .quire-bench-swatch')).length")).toBe(0);
        expect(await tab.run("[...document.querySelectorAll('.quire-qr input[type=radio]')].filter((each) => !each.closest('.quire-bench-choices')).length")).toBe(0);
        expect(await tab.run("[...document.querySelectorAll('.quire-qr :is(textarea, input:not([type=radio], [type=range], [type=file]))')].filter((each) => !each.matches('.quire-bench-typed')).length")).toBe(0);
        expect(await tab.run("[...document.querySelectorAll('.quire-bench-pictured')].map((each) => each.getAttribute('aria-label'))")).toEqual(["shape", "corners", "direction", "flag"]);
        expect(await tab.run("[document.querySelector('.quire-qr-out').inert, [...document.querySelectorAll('.quire-qr-out .quire-bench-press')].map((each) => [each.textContent, each.classList.contains('quiet')])]")).toEqual([true, [["copy", false], ["save PNG", true], ["save SVG", true]]]);
        // typing a link: the code follows each letter, its square the same size throughout
        await press(".quire-qr-form[data-kind=text] textarea");
        const boxSize = () => tab.run<string>("(() => { const b = document.querySelector('.quire-qr-box').getBoundingClientRect(); return b.width + 'x' + b.height; })()");
        const sizes = new Set<string>();
        for (const letter of "https://example.com") {
            await tab.type(letter);
            sizes.add(await boxSize());
        }
        expect(sizes.size).toBe(1);
        expect(await tab.run("window.qr.shown().payload")).toBe("https://example.com");
        await until(verdict);
        expect(await tab.run<string>("document.querySelector('.quire-bench-said').textContent")).toMatch(/^Version 2, 25 by 25 modules, error correction (high|highest)\. It reads back as written\.$/);
        expect(await tab.run("document.querySelector('.quire-qr-out').inert")).toBe(false);
        // Ctrl+C copies the code as a PNG, at the size chosen
        await tab.run("document.activeElement.blur()");
        await tab.press("c", { ctrl: true });
        await until("window.copied.length === 1");
        expect(await tab.run("window.copied[0]")).toEqual({ width: 1024, height: 1024 });
        // save PNG and save SVG name their files by what the code holds
        await pressText("save PNG");
        await pressText("save SVG");
        await until("window.downloads['qr-link-example-com.png'] > 100 && window.downloads['qr-link-example-com.svg'] > 100");
        // the right-click menu on the code
        const boxAt = await centerOf("document.querySelector('.quire-qr-box')");
        await tab.run(`document.querySelector('.quire-qr-box').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${boxAt.x}, clientY: ${boxAt.y} }))`);
        await until("document.querySelector('.quire-menu:popover-open')");
        expect(await tab.run<string[]>("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-items button')].map((each) => each.querySelector('.quire-menu-label')?.textContent ?? each.textContent)")).toEqual(expect.arrayContaining([expect.stringContaining("Copy"), expect.stringContaining("Save as SVG"), expect.stringContaining("Save as PNG"), expect.stringContaining("Paste a picture to read")]));
        await tab.press("Escape");
        // each shape, a flag and a dark ground: each still reads back, the small picture chosen
        for (const tip of ["Dots", "Joined", "Bars"]) {
            await press(`.quire-bench-pictured label[title="${tip}"]`);
            await until(`document.querySelector('.quire-bench-pictured label[title="${tip}"] input').checked`);
            await until(verdict);
        }
        await pressText("flag");
        await until("document.querySelector('.quire-qr-fold:has(.quire-bench-pictured[aria-label=flag])').classList.contains('open')");
        await press('.quire-bench-pictured label[title="The trans flag"]');
        await until("document.querySelector('.quire-bench-said').textContent.includes('drawn deeper')");
        await until(verdict);
        // a picture in the middle: the error correction raised as far as it needs, and it still reads back
        const scene = await tab.run<number[]>("(async () => { const c = new OffscreenCanvas(300, 200); const g = c.getContext('2d'); g.fillStyle = '#e07a5f'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#3d405b'; g.beginPath(); g.arc(150, 100, 70, 0, 7); g.fill(); return [...new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())]; })()");
        await Bun.write(`${folder}/picture.png`, new Uint8Array(scene));
        await tab.files([`${folder}/picture.png`]);
        await pressText("in the middle");
        await until("document.querySelector('.quire-qr-middle.shown')");
        await until(verdict);
        expect(await tab.run<string>("[...document.querySelectorAll('.quire-bench-press')].find((each) => each.textContent.includes('another picture'))?.textContent")).toBe("choose another picture");
        // the keys pick a kind: 2 is Wi-Fi, and its form grows open and makes a login
        await tab.run("document.activeElement.blur()");
        await tab.press("2");
        await until("document.querySelector('.quire-qr-form[data-kind=wifi]').classList.contains('open') && !document.querySelector('.quire-qr-form[data-kind=text]').classList.contains('open')");
        // the form has grown to its height before it is pressed
        await tab.wait(450);
        await press(".quire-qr-form[data-kind=wifi] input");
        await tab.type("Home; net");
        await tab.press("Tab");
        await tab.type("pa:ss");
        expect(await tab.run("window.qr.shown().payload")).toBe("WIFI:T:WPA;S:Home\\; net;P:pa\\:ss;;");
        expect(await tab.run("[...document.querySelectorAll('.quire-qr-form[data-kind=wifi] .quire-bench-label')].map((each) => each.textContent)")).toEqual(["network name", "password", "security", "the network's name is"]);
        // a key still picks a kind with a round dot holding the keyboard
        await tab.run("document.querySelector('input[value=nopass]').focus()");
        await tab.press("1");
        await until("document.querySelector('.quire-qr-form[data-kind=text]').classList.contains('open')");
        // too long: said plainly, the last code kept
        await tab.run("document.activeElement.blur()");
        await tab.run("(() => { const t = document.querySelector('.quire-qr-form[data-kind=text] textarea'); t.value = 'x'.repeat(3000); t.dispatchEvent(new Event('input')); })()");
        expect(await tab.run<string>("document.querySelector('.quire-bench-said').textContent")).toStartWith("Too long for a QR code");
        expect(await tab.run("document.querySelector('.quire-qr').classList.contains('stale')")).toBe(true);
        // reading: a picture pasted, with two codes in it, each laid out as a group of the column
        await tab.run("window.picture(['https://example.com/one', 'WIFI:T:WPA;S:Cafe;P:latte;;'], 'two.png').then((file) => { const data = new DataTransfer(); data.items.add(file); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })");
        await until("window.qr.found().length === 2");
        expect(await tab.run("[document.querySelector('.quire-qr').classList.contains('reading'), document.querySelector('input[value=read]').checked]")).toEqual([true, true]);
        await until("document.querySelector('.quire-bench-said').textContent === 'Found 2 codes.'");
        expect(await tab.run<string[]>("[...document.querySelectorAll('.quire-qr-card > .quire-bench-heading')].map((each) => each.textContent)")).toEqual(["1. link", "2. Wi-Fi"]);
        expect(await tab.run<string[]>("[...document.querySelectorAll('.quire-qr-card')[1].querySelectorAll('.quire-qr-line')].map((each) => each.querySelector('.quire-bench-label').textContent + ': ' + each.querySelector('.quire-qr-value').textContent)")).toEqual(["network: Cafe", "password: latte", "security: WPA"]);
        // a link is shown and copied, never opened
        expect(await tab.run("document.querySelectorAll('.quire-qr-card a').length")).toBe(0);
        await pressText("copy", ".quire-qr-card");
        await until("window.copied.some((each) => each.text === 'https://example.com/one')");
        expect(await tab.run<string>("document.querySelector('.quire-bench-said').textContent")).toBe("Copied the address.");
        // m and r go between the two, each with its own line
        await tab.run("document.activeElement.blur()");
        await tab.press("m");
        await until("!document.querySelector('.quire-qr').classList.contains('reading')");
        expect(await tab.run<string>("document.querySelector('.quire-bench-said').textContent")).toStartWith("Too long for a QR code");
        await tab.press("r");
        await until("document.querySelector('.quire-bench-said').textContent === 'Copied the address.'");
        // dropped
        await tab.run("window.picture(['dropped here'], 'drop.png').then((file) => { const data = new DataTransfer(); data.items.add(file); document.querySelector('.quire-qr-box').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); })");
        await until("window.qr.found()[0]?.text === 'dropped here'");
        // chosen, with Ctrl+O
        const chosen = await tab.run<number[]>("window.picture(['chosen file'], 'chosen.png').then(async (file) => [...new Uint8Array(await file.arrayBuffer())])");
        await Bun.write(`${folder}/chosen.png`, new Uint8Array(chosen));
        await tab.files([`${folder}/chosen.png`]);
        await tab.press("o", { ctrl: true });
        await until("window.qr.found()[0]?.text === 'chosen file'");
        // paste from the right-click menu
        await tab.run("window.picture(['from the menu'], 'menu.png').then((file) => (window.clipboardPicture = file))");
        await tab.run(`document.querySelector('.quire-qr-box').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${boxAt.x}, clientY: ${boxAt.y} }))`);
        await until("document.querySelector('.quire-menu:popover-open')");
        await tab.run("[...document.querySelectorAll('.quire-menu:popover-open .quire-menu-items button')].find((each) => each.textContent.includes('Paste a picture')).click()");
        await until("window.qr.found()[0]?.text === 'from the menu'");
        // a picture with no code in it
        await tab.run("(async () => { const c = new OffscreenCanvas(200, 200); c.getContext('2d').fillRect(0, 0, 100, 100); const file = new File([await c.convertToBlob()], 'none.png', { type: 'image/png' }); window.qr.read(file); })()");
        await until("document.querySelector('.quire-bench-said').textContent === 'No QR code found in this picture.'");
        expect(await tab.run("document.querySelectorAll('.quire-qr-card').length")).toBe(0);
        // nothing was fetched from anywhere
        expect(tab.requests.filter((each) => /^https?:/.test(each.url))).toEqual([]);
        expect(tab.errors).toEqual([]);
    } finally {
        await page.close();
        await rm(folder, { recursive: true, force: true });
    }
}, 120_000);
