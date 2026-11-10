// <drop-box>: click or tap to drop a block; it falls to the floor and stops.
// A deliberately small example of a demo a post can embed.

const GRAVITY = 2400; // px per second squared
const SIZE = 28;

interface Box {
    x: number;
    y: number;
    speed: number;
    resting: boolean;
}

class DropBox extends HTMLElement {
    #canvas = document.createElement("canvas");
    #boxes: Box[] = [];
    #frame = 0;
    #last = 0;

    connectedCallback(): void {
        this.#canvas.style.cssText = "display:block;width:100%;height:14rem;touch-action:manipulation;cursor:pointer";
        this.#canvas.setAttribute("role", "img");
        this.#canvas.setAttribute("aria-label", "An empty floor. Click to drop a block onto it.");
        this.append(this.#canvas);
        this.#canvas.addEventListener("pointerdown", this.#drop);
        this.#draw();
    }

    disconnectedCallback(): void {
        cancelAnimationFrame(this.#frame);
        this.#canvas.removeEventListener("pointerdown", this.#drop);
    }

    #drop = (event: PointerEvent): void => {
        const bounds = this.#canvas.getBoundingClientRect();
        this.#boxes.push({ x: event.clientX - bounds.left - SIZE / 2, y: -SIZE, speed: 0, resting: false });
        if (this.#boxes.length > 40) this.#boxes.shift();
        if (!this.#frame) {
            this.#last = performance.now();
            this.#frame = requestAnimationFrame(this.#step);
        }
    };

    #step = (now: number): void => {
        const seconds = Math.min((now - this.#last) / 1000, 0.05);
        this.#last = now;
        const floor = this.#canvas.clientHeight - 6 - SIZE;

        for (const box of this.#boxes) {
            if (box.resting) continue;
            box.speed += GRAVITY * seconds;
            box.y += box.speed * seconds;
            if (box.y >= floor) {
                box.y = floor;
                box.resting = true;
            }
        }

        this.#draw();
        this.#frame = this.#boxes.every((box) => box.resting) ? 0 : requestAnimationFrame(this.#step);
    };

    /** Reads one of the page's color properties as a value a canvas accepts. */
    #color(property: string): string {
        this.style.color = `var(${property})`;
        const resolved = getComputedStyle(this).color;
        this.style.color = "";
        return resolved;
    }

    #draw(): void {
        const canvas = this.#canvas;
        const scale = window.devicePixelRatio || 1;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        if (canvas.width !== width * scale || canvas.height !== height * scale) {
            canvas.width = width * scale;
            canvas.height = height * scale;
        }

        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(scale, 0, 0, scale, 0, 0);
        context.clearRect(0, 0, width, height);

        context.fillStyle = this.#color("--ink");
        context.fillRect(0, height - 6, width, 6);

        context.fillStyle = this.#color("--accent");
        for (const box of this.#boxes) context.fillRect(Math.round(box.x), Math.round(box.y), SIZE, SIZE);
    }
}

customElements.define("drop-box", DropBox);
