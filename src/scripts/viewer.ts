// Clicking a picture in a post or a project lifts it out of the page, moves
// it to the middle of the window at full size, and puts it back where it was
// when it is clicked again, Escape is pressed or the page is scrolled.
//
// It is one picture moving, not a second one fading in: a copy is laid over
// the original at its final place and size, then transformed back onto the
// original's place and let go, so it travels there. Closing is the same run
// in reverse, to wherever the original is by then.

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const still = matchMedia("(prefers-reduced-motion: reduce)");

interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Where the picture itself is drawn inside its element, which differs when it is fitted with `object-fit: contain`. */
function drawn(picture: HTMLImageElement): Box {
    const box = picture.getBoundingClientRect();
    if (getComputedStyle(picture).objectFit !== "contain" || !picture.naturalWidth) return box;
    const scale = Math.min(box.width / picture.naturalWidth, box.height / picture.naturalHeight);
    const width = picture.naturalWidth * scale;
    const height = picture.naturalHeight * scale;
    return { left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2, width, height };
}

/** The largest version of a picture that the page knows of. */
function largest(picture: HTMLImageElement, link?: HTMLAnchorElement | null): string {
    if (link) return link.href;
    const candidates = (picture.srcset || "")
        .split(",")
        .map((part) => part.trim().split(/\s+/))
        .filter((part): part is [string, string] => part.length === 2 && part[1].endsWith("w"))
        .map(([address, width]) => ({ address, width: Number.parseInt(width, 10) }))
        .sort((a, b) => b.width - a.width);
    return candidates[0] ? new URL(candidates[0].address, location.href).href : picture.currentSrc || picture.src;
}

/** As large as the window allows with a margin, and for a photograph no larger than it really is. */
function centered(shape: number, limit: number): Box {
    const margin = Math.min(innerWidth, innerHeight) * 0.04 + 8;
    let width = Math.min(innerWidth - margin * 2, (innerHeight - margin * 2) * shape, limit);
    width = Math.max(width, 1);
    const height = width / shape;
    return { left: (innerWidth - width) / 2, top: (innerHeight - height) / 2, width, height };
}

/** The transform that makes something at `to` appear to be at `from`. */
const over = (from: Box, to: Box) => `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`;

let closeOpen: (() => void) | undefined;

function open(picture: HTMLImageElement, link?: HTMLAnchorElement | null): void {
    if (closeOpen || !picture.naturalWidth) return;
    const pixel = Boolean(picture.closest(".pixel")) || picture.classList.contains("pixel");
    const shape = picture.naturalWidth / picture.naturalHeight;
    const from = drawn(picture);
    // Pixel art may be enlarged; a photograph is shown at most twice the size it has on the page's largest copy.
    const to = centered(shape, pixel ? Infinity : Math.max(from.width, 2400));
    const radius = Number.parseFloat(getComputedStyle(picture).borderTopLeftRadius) || 0;

    const viewer = document.createElement("div");
    viewer.className = "viewer";
    viewer.tabIndex = -1;
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-modal", "true");
    viewer.setAttribute("aria-label", picture.alt ? `${picture.alt}. Press Escape to close.` : "Picture. Press Escape to close.");
    const shade = document.createElement("div");
    shade.className = "viewer-shade";
    const copy = document.createElement("img");
    copy.className = pixel ? "viewer-picture pixel" : "viewer-picture";
    copy.alt = picture.alt;
    copy.src = picture.currentSrc || picture.src;
    Object.assign(copy.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
    viewer.append(shade, copy);
    document.body.append(viewer);

    // The sharper copy takes over once it has arrived; until then the one already on the page is stretched.
    const large = largest(picture, link);
    if (large !== copy.src) {
        const loading = new Image();
        loading.src = large;
        void loading
            .decode()
            .then(() => {
                if (copy.isConnected) copy.src = large;
            })
            .catch(() => {});
    }

    picture.style.visibility = "hidden";
    const time = still.matches ? 0 : 420;
    const corner = (box: Box) => `${(radius * to.width) / box.width}px`;
    copy.animate(
        [
            { transform: over(from, to), borderRadius: corner(from) },
            { transform: "none", borderRadius: corner(to) },
        ],
        { duration: time, easing: EASE },
    );
    shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: still.matches ? 150 : 320, easing: "ease-out" });
    if (still.matches) copy.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
    viewer.focus({ preventScroll: true });

    let closing = false;
    const shut = () => {
        if (closing) return;
        closing = true;
        // Measured again: the page may have been resized or scrolled since.
        picture.style.visibility = "";
        const back = drawn(picture);
        picture.style.visibility = "hidden";
        const done = () => {
            viewer.remove();
            picture.style.visibility = "";
            removeEventListener("keydown", key, true);
            removeEventListener("resize", shut);
            closeOpen = undefined;
            (link ?? picture).focus({ preventScroll: true });
        };
        shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: still.matches ? 120 : 300, easing: "ease-in", fill: "forwards" });
        if (still.matches) {
            copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" }).finished.then(done, done);
            return;
        }
        copy.animate(
            [
                { transform: getComputedStyle(copy).transform, borderRadius: getComputedStyle(copy).borderTopLeftRadius },
                { transform: over(back, to), borderRadius: corner(back) },
            ],
            { duration: 340, easing: EASE, fill: "forwards" },
        ).finished.then(done, done);
    };
    const key = (event: KeyboardEvent) => {
        if (event.key !== "Escape" && event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        event.stopPropagation();
        shut();
    };
    viewer.addEventListener("click", shut);
    viewer.addEventListener("wheel", shut, { passive: true });
    viewer.addEventListener("touchmove", shut, { passive: true });
    addEventListener("keydown", key, true);
    addEventListener("resize", shut);
    closeOpen = shut;
}

// Pictures in the text and the cover open on a click or with the keyboard.
for (const picture of document.querySelectorAll<HTMLImageElement>(".post .prose img, .post img.post-cover")) {
    if (picture.closest("a, .specimen, .timeline, .photo")) continue;
    picture.dataset.zoom = "";
    picture.tabIndex = 0;
    picture.setAttribute("role", "button");
    picture.setAttribute("aria-label", picture.alt ? `View larger: ${picture.alt}` : "View larger");
    picture.addEventListener("click", () => open(picture));
    picture.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open(picture);
    });
}

// A gallery picture is already a link to its full size. With scripts the link opens the viewer instead.
for (const link of document.querySelectorAll<HTMLAnchorElement>(".gallery a")) {
    const picture = link.querySelector("img");
    if (!picture) continue;
    picture.dataset.zoom = "";
    link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        open(picture, link);
    });
}
export {};
