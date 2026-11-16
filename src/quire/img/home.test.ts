// The home screen of a page that is one kind's own, in headless Chromium. mdQuire's offers its own
// templates and its sample and no picture, and leaves a picture pasted on it alone. imgQuire's says
// first how a picture arrives and offers a picture and a picture from a file, with none of mdQuire's
// templates or its sample; a document of the other kind is still listed there, its row saying that it is
// one, and pressed is opened on mdQuire's page; a picture pasted there opens; and each page comes back to
// the document last open on it, not on the other.

import { afterAll, expect, test } from "bun:test";
import { imgPage, type ImgPage } from "../../../scripts/img-page";

let page: ImgPage | undefined;
afterAll(async () => {
    await page?.close();
});

const shelf = () =>
    page!.tab.run<{ lead: string | null; fresh: string[]; ways: string[]; rows: string[] }>(
        "({ lead: document.querySelector('.quire-shelf-lead')?.textContent ?? null, fresh: [...document.querySelectorAll('.quire-shelf-kinds button')].map((each) => each.textContent.trim()), ways: [...document.querySelectorAll('.quire-shelf-ways button')].map((each) => each.textContent.trim()), rows: [...document.querySelectorAll('.quire-shelf-list li')].map((each) => each.textContent.replace(/\\s+/g, ' ').trim()) })",
    );
const shown = () => page!.tab.run<boolean>("!document.querySelector('.quire-shelf').inert");
const ready = "window.app && !document.querySelector('.quire-shelf').inert && document.querySelector('.quire-shelf-kinds button')";
const pastePicture = () =>
    page!.tab.run("(async () => { const canvas = new OffscreenCanvas(300, 200); canvas.getContext('2d').fillRect(0, 0, 300, 200); const blob = await canvas.convertToBlob({ type: 'image/png' }); const data = new DataTransfer(); data.items.add(new File([blob], 'shot.png', { type: 'image/png' })); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })()");

test("mdQuire's own home screen offers no picture and leaves a pasted one alone; imgQuire's leads with pictures, lists a document and sends it to mdQuire's page; each page comes back to its own", async () => {
    page = await imgPage(`img-home-${Date.now()}`);
    if (!page) return console.warn("home.test.ts skipped: needs a Chromium");
    const address = await page.tab.run<string>("location.href.split('#')[0].split('?')[0]");

    // as mdQuire's own page
    await page.tab.open(`${address}?md#md`, 800);
    await page.until(ready);
    const md = await shelf();
    expect(md.lead).toBeNull();
    expect(md.fresh).toContain("blank");
    expect(md.fresh).not.toContain("picture");
    expect(md.ways).toContain("see a sample");
    // a picture pasted on its home screen makes nothing and opens nothing
    await pastePicture();
    await page.tab.wait(800);
    expect(await shown()).toBe(true);
    // a document written there, kept in this browser
    await page.tab.run("[...document.querySelectorAll('.quire-shelf-kinds button')].find((each) => each.textContent.trim() === 'blank').click()");
    await page.until("document.querySelector('.quire-shelf').inert");
    await page.tab.type("A note");
    await page.tab.wait(1500);

    // as imgQuire's own page: it does not come back to what was being written on mdQuire's, so its home screen is shown
    await page.tab.open(`${address}?img#img`, 800);
    await page.until(ready);
    const img = await shelf();
    expect(img.lead).toBe("Paste, drop or open a picture");
    expect(img.fresh).toEqual(["picture", "from a file"]);
    expect(img.ways).toContain("open a file");
    expect(img.ways).not.toContain("see a sample");
    // the document of the other kind is listed and says that it is one
    expect(img.rows.some((row) => row.includes("document, this browser"))).toBe(true);
    // pressed, it is opened on mdQuire's own page and not here
    const row = await page.tab.run<{ x: number; y: number }>("(() => { const row = [...document.querySelectorAll('.quire-shelf-list li')].find((each) => each.textContent.includes('document, this browser')); const box = row.querySelector('.quire-shelf-open').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()");
    await page.tab.click(row.x, row.y);
    await page.until("location.hash === '#md' && window.app && document.querySelector('.quire-shelf').inert && document.querySelector('.quire-name-home')?.textContent.includes('Untitled')");
    expect(await page.tab.run("!!window.app.editing().stage")).toBe(false);

    // back on imgQuire's page the home screen is shown again, and a picture pasted there opens in the picture editor
    await page.tab.open(`${address}?img2#img`, 800);
    await page.until(ready);
    await pastePicture();
    await page.until("document.querySelector('.quire-shelf').inert && window.app.editing().stage?.loaded()");
    await page.tab.wait(1200);
    // and mdQuire's page still comes back to its own document, not to the picture
    await page.tab.open(`${address}?md2#md`, 800);
    await page.until("window.app && document.querySelector('.quire-shelf').inert && document.querySelector('.quire-name-home')?.textContent.includes('Untitled')");
    expect(await page.tab.run("!!window.app.editing().stage")).toBe(false);
}, 120_000);
