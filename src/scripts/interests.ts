// The interests list, opening a thing in a sheet: one of two ways being compared, used only when the
// list's address ends in ?sheet (without it a row is a plain link to the thing's page, which opens in
// the site's panel). A row pressed swells into its screen, a sheet over the page, and the sheet shrinks
// back into the row's cover when it is closed with the word close, Escape, a press outside it, or the
// browser's Back. The address bar shows the thing's own address while its sheet is open.
//
// It is one thing growing, not a second one fading in: the sheet is laid out at its open place, then
// drawn so small and so far off that its cover lies exactly on the row's and nothing else of it
// shows, and let go from there. Closing is the same run backwards, to wherever the row is by then.
//
// The video at the top of a screen is the site's own copy of the trailer, fetched only when the line
// under the cover (or the cover) is pressed; closing the screen takes it away.

import { EASE, boxOf, still, type Box } from "./opening";

const OPEN = 460;
const SHUT = 360;

const found = document.querySelector<HTMLDialogElement>("#sheet");
if (found && new URLSearchParams(location.search).has("sheet")) run(found);

function run(sheet: HTMLDialogElement): void {
    /** The screen that is open, by the last part of its address. */
    let current: string | undefined;
    /** The flight under way, if one is. */
    let moving: Animation | undefined;

    const screenOf = (id: string) => sheet.querySelector<HTMLElement>(`[data-screen="${CSS.escape(id)}"]`);
    const tileOf = (id: string) => document.querySelector<HTMLAnchorElement>(`a[data-open="${CSS.escape(id)}"]`);
    /** Which screen an address is, if it is one. */
    const idAt = (path: string): string | undefined => {
        const id = /^\/interests\/([a-z0-9-]+)\/?$/.exec(path)?.[1];
        return id && screenOf(id) ? id : undefined;
    };

    /** Takes a screen's video away and puts its cover back. */
    const stop = (screen: HTMLElement) => {
        screen.querySelector(".stage video")?.remove();
        screen.querySelector(".play-here")?.classList.remove("playing");
    };

    /** Puts one screen in the sheet, and the page's title and the sheet's trail to match. */
    const put = (id: string): HTMLElement | undefined => {
        const screen = screenOf(id);
        if (!screen) return undefined;
        for (const other of sheet.querySelectorAll<HTMLElement>(".screen")) {
            other.hidden = other !== screen;
            if (other !== screen) stop(other);
        }
        sheet.setAttribute("aria-labelledby", `screen-${id}`);
        const here = sheet.querySelector(".sheet-here");
        if (here) here.textContent = screen.dataset.name ?? "";
        document.title = screen.dataset.title ?? document.title;
        return screen;
    };

    /**
     * How the sheet is drawn so that its cover lies on the tile's cover and nothing else of it shows:
     * a move and a scale about the middle of its own cover, and a cut around that cover the shape of
     * the tile. Nothing if either cannot be measured.
     */
    const onTile = (id: string): Keyframe | undefined => {
        const picture = tileOf(id)?.querySelector("img");
        const cover = screenOf(id)?.querySelector<HTMLImageElement>(".stage-cover");
        if (!picture || !cover) return undefined;
        const tile = boxOf(picture);
        const big = boxOf(cover);
        const whole = boxOf(sheet);
        if (!tile.width || !tile.height || !big.width || !big.height) return undefined;
        // The tile fills its box with the picture, cutting what does not fit; the sheet shows all of it.
        const shape = big.width / big.height;
        const scale = Math.max(tile.width, tile.height * shape) / big.width;
        const middle = { x: big.left + big.width / 2 - whole.left, y: big.top + big.height / 2 - whole.top };
        const cut: Box = { width: tile.width / scale, height: tile.height / scale, left: 0, top: 0 };
        cut.left = middle.x - cut.width / 2;
        cut.top = middle.y - cut.height / 2;
        const corner = (Number.parseFloat(getComputedStyle(picture).borderTopLeftRadius) || 0) / scale;
        const px = (n: number) => `${n.toFixed(2)}px`;
        return {
            transformOrigin: `${px(middle.x)} ${px(middle.y)}`,
            transform: `translate(${px(tile.left + tile.width / 2 - (big.left + big.width / 2))}, ${px(tile.top + tile.height / 2 - (big.top + big.height / 2))}) scale(${scale.toFixed(5)})`,
            clipPath: `inset(${px(cut.top)} ${px(whole.width - cut.left - cut.width)} ${px(whole.height - cut.top - cut.height)} ${px(cut.left)} round ${px(corner)})`,
        };
    };

    /** The sheet at rest, for the other end of a flight. */
    const atRest = (from: Keyframe): Keyframe => ({
        transformOrigin: from.transformOrigin,
        transform: "none",
        clipPath: `inset(0px 0px 0px 0px round ${getComputedStyle(sheet).borderTopLeftRadius})`,
    });

    /** The tile's own copy of the cover stands in the sheet until the larger one has come. */
    const lend = (id: string) => {
        const small = tileOf(id)?.querySelector("img");
        const cover = screenOf(id)?.querySelector<HTMLImageElement>(".stage-cover");
        if (small?.currentSrc && cover) cover.style.backgroundImage = `url("${small.currentSrc}")`;
    };

    /** Opens a screen. `fly` grows it out of its tile; without it the sheet is simply there. */
    const open = (id: string, fly: boolean) => {
        moving?.cancel();
        const screen = put(id);
        if (!screen) return;
        current = id;
        lend(id);
        if (sheet.open && !sheet.matches(":modal")) sheet.close();
        if (!sheet.open) sheet.showModal();
        sheet.scrollTop = 0;
        sheet.classList.add("shown");
        if (!fly) return;
        if (still.matches) {
            moving = sheet.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
            return;
        }
        const from = onTile(id);
        if (from) moving = sheet.animate([from, atRest(from)], { duration: OPEN, easing: EASE });
    };

    /** Closes the open screen, back into its tile. */
    const close = () => {
        const id = current;
        if (!id || !sheet.open) return;
        current = undefined;
        moving?.cancel();
        document.title = sheet.dataset.listTitle ?? document.title;
        sheet.classList.remove("shown");
        const gone = () => {
            sheet.close();
            const screen = screenOf(id);
            if (screen) stop(screen);
        };
        sheet.scrollTop = 0;
        const to = still.matches ? undefined : onTile(id);
        moving = to
            ? sheet.animate([atRest(to), to], { duration: SHUT, easing: EASE, fill: "forwards" })
            : sheet.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" });
        const flight = moving;
        flight.finished.then(
            () => {
                gone();
                flight.cancel();
            },
            () => {},
        );
    };

    /** Puts another screen in the open sheet, in place of the one there: for a link from one screen to another. */
    const swap = (id: string) => {
        const screen = put(id);
        if (!screen) return;
        current = id;
        lend(id);
        sheet.scrollTop = 0;
        screen.animate([{ opacity: 0 }, { opacity: 1 }], { duration: still.matches ? 100 : 220, easing: "ease-out" });
    };

    /**
     * How many steps of the browser's history lie between this screen and the list it was opened from
     * on this visit: one for a tile pressed, one more for each link followed from screen to screen.
     * None when the screen's address was arrived at directly, since the list is not behind it then.
     */
    const steps = (): number => (typeof history.state?.steps === "number" ? history.state.steps : 0);

    /** The visitor asks for the screen to go: the address goes back to the list's, and the screen with it. */
    const dismiss = () => {
        if (!current) return;
        // Opened from the list on this visit: Back is the way it came. Arrived at directly: the list is a step on.
        if (steps() > 0) history.go(-steps());
        else {
            history.pushState({}, "", "/interests/?sheet");
            close();
        }
    };

    for (const tile of document.querySelectorAll<HTMLAnchorElement>("a[data-open]")) {
        tile.addEventListener("click", (event) => {
            const id = tile.dataset.open;
            // A press that asks for a new tab or window is left to do that.
            if (!id || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            if (current) return;
            history.pushState({ steps: 1 }, "", tile.href);
            open(id, true);
        });
    }

    for (const way of sheet.querySelectorAll<HTMLElement>("[data-close]")) {
        way.addEventListener("click", (event) => {
            if (event instanceof MouseEvent && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
            event.preventDefault();
            dismiss();
        });
    }

    // Escape asks the sheet to close; it goes the same way as every other close.
    sheet.addEventListener("cancel", (event) => {
        event.preventDefault();
        dismiss();
    });
    // A link in one screen to another screen puts that screen in the sheet, and no page is loaded.
    sheet.addEventListener("click", (event) => {
        const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
        if (!link || link.hasAttribute("data-close") || link.origin !== location.origin) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const id = idAt(link.pathname);
        if (!id) return;
        event.preventDefault();
        if (id === current) return;
        history.pushState({ steps: steps() > 0 ? steps() + 1 : 0 }, "", link.href);
        swap(id);
    });
    // A press on the shade around the sheet reaches the sheet itself, from outside its box.
    sheet.addEventListener("click", (event) => {
        if (event.target !== sheet) return;
        const box = boxOf(sheet);
        const inside = event.clientX >= box.left && event.clientX <= box.left + box.width && event.clientY >= box.top && event.clientY <= box.top + box.height;
        if (!inside) dismiss();
    });
    // The page under the shade stays where it is: a wheel or a finger on the shade moves nothing.
    for (const kind of ["wheel", "touchmove"] as const) {
        sheet.addEventListener(
            kind,
            (event) => {
                if (event.target === sheet && event.cancelable) event.preventDefault();
            },
            { passive: false },
        );
    }

    // Back and Forward: the address says which screen is open, if any.
    addEventListener("popstate", () => {
        const id = idAt(location.pathname);
        if (id && current && id !== current) swap(id);
        else if (id && !current) open(id, true);
        else if (!id && current) close();
    });

    // The video: the site's copy of the trailer, once asked for, in the browser's own player.
    for (const place of sheet.querySelectorAll<HTMLElement>(".play-here[data-video]")) {
        const stage = place.querySelector<HTMLElement>(".stage");
        const button = place.querySelector<HTMLButtonElement>(".play-button");
        if (!stage || !button) continue;
        const play = () => {
            if (place.classList.contains("playing") || !place.dataset.video) return;
            const video = document.createElement("video");
            video.src = place.dataset.video;
            video.title = place.dataset.videoTitle ?? "";
            video.controls = true;
            video.autoplay = true;
            video.playsInline = true;
            // The stage grows from the height it has to the video's own shape.
            const before = stage.getBoundingClientRect().height;
            stage.append(video);
            place.classList.add("playing");
            const after = stage.getBoundingClientRect().height;
            if (!still.matches && Math.abs(after - before) > 1) stage.animate([{ height: `${before}px` }, { height: `${after}px` }], { duration: 420, easing: EASE });
        };
        button.addEventListener("click", play);
        stage.addEventListener("click", play);
    }
}
