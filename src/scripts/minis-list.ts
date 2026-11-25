// The minis list runs one mini at a time, as the owner chose on 24 November 2026: the card under the
// mouse, or reached with the keyboard, or last touched, runs; with none of those, the first card in
// view does. Every other card holds a still frame of itself (Mote's `data-still`, src/mote/stage.ts).

/** Which card runs: the one pointed at, or else the first of those in view. */
export function liveCard<T>(cards: readonly T[], pointed: T | undefined, inView: ReadonlySet<T>): T | undefined {
    return pointed ?? cards.find((card) => inView.has(card));
}

export function minisOneAtATime(list: Element | null): void {
    if (!list) return;
    const cards = [...list.querySelectorAll<HTMLElement>(":scope > li")];
    const inView = new Set<HTMLElement>();
    let pointed: HTMLElement | undefined;
    const choose = () => {
        const live = liveCard(cards, pointed, inView);
        for (const card of cards) card.querySelector("[data-mini]")?.toggleAttribute("data-still", card !== live);
    };
    const seen = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            const card = entry.target as HTMLElement;
            if (entry.isIntersecting) inView.add(card);
            else inView.delete(card);
        }
        choose();
    });
    for (const card of cards) {
        seen.observe(card);
        card.addEventListener("pointerenter", () => {
            pointed = card;
            choose();
        });
        // a finger leaves when it lifts; the card it touched keeps running until another is touched
        card.addEventListener("pointerleave", (event) => {
            if (event.pointerType === "touch" || pointed !== card) return;
            pointed = undefined;
            choose();
        });
        card.addEventListener("focusin", () => {
            pointed = card;
            choose();
        });
        card.addEventListener("focusout", () => {
            if (pointed !== card || card.matches(":hover")) return;
            pointed = undefined;
            choose();
        });
    }
}
