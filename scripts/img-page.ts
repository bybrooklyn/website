// A page with the Quires' app and both kinds of document on one shelf, for imgQuire's browser tests
// (src/quire/img/*.test.ts): the clipboard watched rather than written, downloads caught, a
// screenshot and a photograph made to paste, and the waits and places those tests share.
//
//   const page = await imgPage("img-stage");
//   if (page) try { await page.paste("screenshot"); ... } finally { await page.close(); }

import { corePage, quire } from "./core-page";

const TOP = '<header class="quire-top"><div class="quire-top-in"><div class="quire-top-line"><nav class="quire-trail"><a class="quire-word" href="/imgquire/">imgQuire</a><span class="quire-stroke quire-name-stroke">/</span><span class="quire-name-home"></span></nav><div class="quire-menus-home"></div><div class="quire-status-home"></div></div><div class="quire-bar-home"></div></div></header>';

/** Opens the page with a database of its own, or gives undefined where there is no Chromium. */
export async function imgPage(database: string, size = { width: 1300, height: 820 }) {
    const page = await corePage(
        `
        import { startApp } from "${quire}/core/app.ts";
        import { markdown } from "${quire}/md/kind.ts";
        import { img } from "${quire}/img/kind.ts";
        // the clipboard is watched rather than written: what was copied is kept, as its pixels
        window.copied = [];
        navigator.clipboard.write = async (items) => {
            for (const item of items) {
                const blob = await item.getType("image/png");
                const bitmap = await createImageBitmap(blob);
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                const context = canvas.getContext("2d");
                context.drawImage(bitmap, 0, 0);
                window.copied.push({ type: blob.type, width: bitmap.width, height: bitmap.height, pixels: context.getImageData(0, 0, bitmap.width, bitmap.height).data });
            }
        };
        window.downloads = {};
        HTMLAnchorElement.prototype.click = function () {
            if (!this.download) return;
            const name = this.download;
            fetch(this.href).then((answer) => answer.arrayBuffer()).then((buffer) => (window.downloads[name] = [...new Uint8Array(buffer)]));
        };
        // a screenshot of a settings page with an address and a token on it, and a photograph
        window.picture = async (kind) => {
            const canvas = new OffscreenCanvas(kind === "photo" ? 4000 : 1200, kind === "photo" ? 3000 : 700);
            const context = canvas.getContext("2d");
            if (kind === "photo") {
                const fade = context.createLinearGradient(0, 0, 4000, 3000);
                fade.addColorStop(0, "#1c3a5a");
                fade.addColorStop(1, "#e8a35c");
                context.fillStyle = fade;
                context.fillRect(0, 0, 4000, 3000);
                for (let at = 0; at < 300; at++) { context.fillStyle = "hsl(" + ((at * 47) % 360) + " 55% 55%)"; context.beginPath(); context.arc((at * 7919) % 4000, (at * 104729) % 3000, 40 + (at % 90), 0, 7); context.fill(); }
            } else {
                context.fillStyle = "#f4f4f6";
                context.fillRect(0, 0, 1200, 700);
                context.fillStyle = "#1d1d1f";
                context.font = "28px sans-serif";
                context.fillText("Account settings", 60, 80);
                context.font = "20px sans-serif";
                context.fillText("Email: someone@example.com", 60, 160);
                context.fillStyle = "#c0102a";
                context.fillText("Token: ghp_9f8a7c6b5d4e3f2a1b0c", 60, 210);
                context.fillStyle = "#0a84ff";
                context.fillRect(60, 260, 180, 48);
            }
            return canvas.convertToBlob({ type: kind === "photo" ? "image/jpeg" : "image/png", quality: 0.92 });
        };
        window.paste = async (kind) => {
            const blob = await window.picture(kind);
            const data = new DataTransfer();
            data.items.add(new File([blob], "image.png", { type: blob.type }));
            window.pastedAt = performance.now();
            document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        };
        window.box = (selector) => { const box = document.querySelector(selector)?.getBoundingClientRect(); return box && { x: box.x, y: box.y, width: box.width, height: box.height }; };
        startApp(document.querySelector("#host"), { kinds: [markdown({}), img()], database: ${JSON.stringify(database)}, top: document.querySelector(".quire-top") }).then((app) => (window.app = app));
    `,
        { body: `${TOP}<div id="host" class="quire-host"></div>`, ...size },
    );
    if (!page) return undefined;
    const tab = page.tab;
    await tab.wait(800);
    // a press on nothing, so that the page has the keyboard as it would once a person has used it
    await tab.click(size.width - 4, Math.round(size.height / 2));
    /** Waits until an expression in the page is true, or gives up after a while. */
    async function until(expression: string, ms = 15_000) {
        const started = Date.now();
        while (Date.now() - started < ms) {
            if (await tab.run<boolean>(`!!(${expression})`)) return;
            await tab.wait(50);
        }
        throw new Error(`waited for ${expression}`);
    }
    return {
        tab,
        close: page.close,
        until,
        boxOf: (selector: string) => tab.run<{ x: number; y: number; width: number; height: number }>(`window.box(${JSON.stringify(selector)})`),
        /** The middle of an element on the screen. */
        middle: async (selector: string) => {
            const box = await tab.run<{ x: number; y: number; width: number; height: number }>(`window.box(${JSON.stringify(selector)})`);
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        },
        /** Pastes a picture and waits for it to be shown with the keyboard on it, giving how many copies the clipboard had before. */
        async paste(kind: "screenshot" | "photo") {
            const before = await tab.run<number>("window.copied.length");
            const was = await tab.run<string>("window.app.editing().current().id ?? ''");
            await tab.run(`window.paste(${JSON.stringify(kind)})`);
            await until(`window.app.editing().current().id !== ${JSON.stringify(was)} && window.app.editing().stage?.loaded() && document.querySelector(".quire-img-frame.shown") && document.activeElement === document.querySelector(".quire-img-stage")`);
            return before;
        },
        /** How long since the paste, once the clipboard has one more picture than `before`. */
        async copiedAfter(before: number) {
            await until(`window.copied.length > ${before}`);
            return tab.run<number>("Math.round(performance.now() - window.pastedAt)");
        },
        /** Where a pixel of the original falls on the screen. */
        onScreen: (x: number, y: number) => tab.run<{ x: number; y: number }>(`(() => { const point = window.app.editing().stage.toScreen({ x: ${x}, y: ${y} }); const box = document.querySelector(".quire-img-stage").getBoundingClientRect(); return { x: box.x + point.x, y: box.y + point.y }; })()`),
        /** The last picture copied, its size alone (its pixels stay in the page). */
        copied: () => tab.run<{ width: number; height: number }>("(({ width, height }) => ({ width, height }))(window.copied.at(-1))"),
    };
}

/** The page, as a test holds it. */
export type ImgPage = NonNullable<Awaited<ReturnType<typeof imgPage>>>;
