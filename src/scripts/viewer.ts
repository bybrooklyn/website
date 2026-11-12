// Clicking a picture anywhere on the site lifts it out of the page, moves it
// to the middle of the window at full size, and puts it back where it was
// when it is clicked again, Escape is pressed or the page is scrolled. Three
// dots in the picture's corner flow out into a small menu, and become a cross
// that closes it: what the picture is, opening
// it in a new tab, downloading it, and what may be done with it.
//
// Every page has it (Document.astro). Which pictures it takes is in WHICH,
// below; a picture can ask to be left alone with `data-no-view`, and another
// script can open one with `view(picture)`.
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

/** What is known about a picture from the page around it: what it is called, and who made it or when. */
function about(picture: HTMLImageElement): { title: string; more: string } {
    const figure = picture.closest("figure");
    const title = figure?.querySelector(".photo-title")?.textContent?.trim() || picture.alt || figure?.querySelector("figcaption")?.textContent?.trim() || "Picture";
    const more = figure?.querySelector(".photo-taken")?.textContent?.trim();
    return { title, more: more ?? "" };
}

/** The three dots, and the menu they flow out into. `address` gives the picture's largest copy. */
function menu(picture: HTMLImageElement, address: () => string): { box: HTMLElement; shut(): boolean; sized(width: number, height: number): void } {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, text = ""): HTMLElementTagNameMap[K] => {
        const made = document.createElement(tag);
        made.className = name;
        made.textContent = text;
        return made;
    };
    const box = make("div", "viewer-menu");
    const dots = make("button", "viewer-dots");
    dots.type = "button";
    dots.setAttribute("aria-label", "More about this picture");
    dots.setAttribute("aria-expanded", "false");
    dots.append(make("i", ""), make("i", ""), make("i", ""));
    const items = make("div", "viewer-items");
    items.inert = true;
    const { title, more } = about(picture);
    const note = make("p", "viewer-note note");
    /** The picture's size is said once its largest copy has arrived, since that is the one opened and downloaded. */
    const sized = (width: number, height: number) => (note.textContent = [`${width} × ${height}`, more].filter(Boolean).join(" · "));
    sized(picture.naturalWidth, picture.naturalHeight);
    const link = (text: string, set: (a: HTMLAnchorElement) => void) => {
        const a = make("a", "", text);
        set(a);
        return a;
    };
    items.append(
        make("p", "viewer-title", title),
        note,
        link("Open in a new tab", (a) => Object.assign(a, { href: address(), target: "_blank", rel: "noopener" })),
        link("Download", (a) => Object.assign(a, { href: address(), download: "" })),
        link("What you may do with it", (a) => (a.href = "/license/")),
    );
    box.append(dots, items);

    const set = (open: boolean) => {
        // the box is given the menu's own size to grow to, and flows there from a circle
        box.style.setProperty("--wide", `${items.offsetWidth}px`);
        box.style.setProperty("--high", `${items.offsetHeight}px`);
        box.classList.toggle("open", open);
        dots.setAttribute("aria-expanded", String(open));
        items.inert = !open;
        if (open) (items.querySelector("a") as HTMLElement).focus({ preventScroll: true });
    };
    dots.addEventListener("click", () => set(!box.classList.contains("open")));
    // nothing done in the menu closes the picture
    for (const kind of ["click", "wheel", "touchmove"]) box.addEventListener(kind, (event) => event.stopPropagation());
    return {
        box,
        sized,
        shut() {
            const was = box.classList.contains("open");
            if (was) set(false);
            return was;
        },
    };
}

let closeOpen: (() => void) | undefined;
/** Takes the open picture away at once, with no flight back: for when the page itself is being left. */
let dropOpen: (() => void) | undefined;

/** Opens a picture in the viewer. `link`, if the picture is one, is where its full size is. */
export function view(picture: HTMLImageElement, link?: HTMLAnchorElement | null): void {
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
    const large = largest(picture, link);
    const more = menu(picture, () => large);
    viewer.append(shade, copy, more.box);
    document.body.append(viewer);
    // The dots sit in the picture's own top right corner, as far from its right edge as from its top, and come in
    // once it has arrived there. Measured against the viewer itself, which is what they are placed in.
    Object.assign(more.box.style, { top: `${to.top + 10}px`, right: `${viewer.clientWidth - to.left - to.width + 10}px` });
    more.box.animate([{ opacity: 0, scale: 0.6 }, { opacity: 0, scale: 0.6, offset: 0.6 }, { opacity: 1, scale: 1 }], { duration: still.matches ? 0 : 560, easing: EASE });

    // The sharper copy takes over once it has arrived; until then the one already on the page is stretched.
    if (large !== copy.src) {
        const loading = new Image();
        loading.src = large;
        void loading
            .decode()
            .then(() => {
                if (!copy.isConnected) return;
                copy.src = large;
                more.sized(loading.naturalWidth, loading.naturalHeight);
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
            drop();
            (link ?? picture).focus({ preventScroll: true });
        };
        more.shut();
        more.box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, fill: "forwards" });
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
    const drop = () => {
        viewer.remove();
        picture.style.visibility = "";
        removeEventListener("keydown", key, true);
        removeEventListener("resize", shut);
        [closeOpen, dropOpen] = [undefined, undefined];
    };
    const key = (event: KeyboardEvent) => {
        // while a picture is open the page under it hears no keys, and Tab goes round what is in the viewer and nowhere else
        if (event.key === "Tab") {
            event.preventDefault();
            const stops = [...viewer.querySelectorAll<HTMLElement>("button, a[href]")].filter((stop) => !stop.closest("[inert]"));
            const at = stops.indexOf(document.activeElement as HTMLElement);
            stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus({ preventScroll: true });
            return;
        }
        event.stopPropagation();
        const inMenu = more.box.contains(document.activeElement);
        if (event.key === "Escape" && more.shut()) return void viewer.focus({ preventScroll: true });
        if (event.key !== "Escape" && (inMenu || (event.key !== "Enter" && event.key !== " "))) return;
        event.preventDefault();
        shut();
    };
    // a click outside the menu closes the menu if it is open, and otherwise the picture
    viewer.addEventListener("click", () => more.shut() || shut());
    viewer.addEventListener("wheel", shut, { passive: true });
    viewer.addEventListener("touchmove", shut, { passive: true });
    addEventListener("keydown", key, true);
    addEventListener("resize", shut);
    closeOpen = shut;
    dropOpen = drop;
}

// Leaving the page takes an open picture with it. Otherwise it would be in the picture the browser takes of the
// page for the change to the next one, under the header, and still open when the page was come back to.
for (const leaving of ["pageswap", "pagehide"]) addEventListener(leaving, () => dropOpen?.());

/**
 * Which pictures open: those in the text of a page, covers, figures, and the one on the photos page.
 * Not one inside a link (it goes where the link goes, except in a gallery, whose links are to the
 * picture itself), nor the type specimen, the timeline, or a game's still.
 */
const WHICH = ".prose img, img.post-cover, .figure img, .gallery a img, .photo-frame > img[src]";
const taken = (picture: HTMLImageElement) => picture.matches(WHICH) && !picture.closest("[data-no-view], .specimen, .timeline, .play-here") && (!picture.closest("a") || Boolean(picture.closest(".gallery a")));

// One listener for the whole page, so that a picture put there later (the photos page changes its own) opens too.
document.addEventListener("click", (event) => {
    const picture = event.target instanceof HTMLImageElement ? event.target : undefined;
    // (one that has not arrived yet is left to whatever it would have done anyway)
    if (!picture || !picture.naturalWidth || !taken(picture) || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    view(picture, picture.closest<HTMLAnchorElement>(".gallery a"));
});
// Each can also be reached and opened with the keyboard, unless it is in a link, which already can be.
for (const picture of document.querySelectorAll<HTMLImageElement>(WHICH)) {
    if (!taken(picture)) continue;
    picture.dataset.zoom = "";
    if (picture.closest("a")) continue;
    picture.tabIndex = 0;
    picture.setAttribute("role", "button");
    picture.setAttribute("aria-label", picture.alt ? `View larger: ${picture.alt}` : "View larger");
    picture.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        view(picture);
    });
}
