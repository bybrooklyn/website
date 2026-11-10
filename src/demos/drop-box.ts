// <drop-box>: a small pile of blocks with real physics. Click or tap an empty
// spot to drop another; pick one up and throw it. Blocks stack, tumble and
// come to rest. It is drawn in the page's own colors.
//
// The physics is the site's own small engine, physics.ts.

import { box, contains, step, wake, type Box, type Hold } from "./physics";

const SIZE = 34;
const MOST = 60;
const FLOOR = 6;
/** The simulation moves in steps of this many seconds, whatever the screen's refresh rate. */
const TICK = 1 / 120;

class DropBox extends HTMLElement {
    #canvas = document.createElement("canvas");
    #blocks: Box[] = [];
    #walls: Box[] = [];
    #hold?: Hold;
    #near = false;
    #visible = false;
    #allowed = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    #frame = 0;
    #last = 0;
    #owed = 0;
    #palette?: { floor: string; fill: string; edge: string };
    #watcher?: IntersectionObserver;
    #resizer?: ResizeObserver;

    connectedCallback(): void {
        const canvas = this.#canvas;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", "A pile of blocks. Click to drop another, or drag one to throw it.");
        this.append(canvas);

        canvas.addEventListener("pointerdown", (event) => {
            const point = { x: event.offsetX, y: event.offsetY };
            // The topmost block under the pointer is picked up; empty space gets a new block.
            const picked = [...this.#blocks].reverse().find((block) => contains(block, point));
            if (picked) {
                const cos = Math.cos(picked.angle);
                const sin = Math.sin(picked.angle);
                const dx = point.x - picked.x;
                const dy = point.y - picked.y;
                this.#hold = { body: picked, lx: dx * cos + dy * sin, ly: -dx * sin + dy * cos, target: point };
            } else {
                this.#drop(point.x, point.y);
            }
            // Keep hearing about this pointer even if it leaves the box.
            canvas.setPointerCapture(event.pointerId);
            this.#start();
        });
        canvas.addEventListener("pointermove", (event) => {
            if (this.#hold) this.#hold.target = { x: event.offsetX, y: event.offsetY };
        });
        const release = () => {
            this.#hold = undefined;
        };
        canvas.addEventListener("pointerup", release);
        canvas.addEventListener("pointercancel", release);
        canvas.addEventListener("pointerenter", () => {
            this.#near = true;
        });
        canvas.addEventListener("pointerleave", () => {
            this.#near = false;
        });

        this.#resizer = new ResizeObserver(() => this.#fit());
        this.#resizer.observe(this);
        // Only run while it can be seen.
        this.#watcher = new IntersectionObserver(([entry]) => {
            this.#visible = Boolean(entry?.isIntersecting);
            if (this.#visible && this.#allowed) this.#start();
            else this.#stop();
        });
        this.#watcher.observe(this);

        this.#fit();
        const middle = canvas.clientWidth / 2;
        const floor = canvas.clientHeight - FLOOR;
        for (const [column, row] of [[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1], [0, 2]] as const) {
            const block = box(middle + column * SIZE, floor - SIZE / 2 - row * SIZE, SIZE, SIZE);
            block.asleep = true;
            this.#blocks.push(block);
        }
        this.#draw();
    }

    disconnectedCallback(): void {
        this.#stop();
        this.#watcher?.disconnect();
        this.#resizer?.disconnect();
    }

    #drop(x: number, y: number): void {
        const block = box(x, y, SIZE, SIZE);
        block.spin = (Math.random() - 0.5) * 3;
        this.#blocks.push(block);
        if (this.#blocks.length > MOST) this.#blocks.shift();
    }

    /** Match the canvas to its box, and put the floor and walls around it. */
    #fit(): void {
        const width = this.clientWidth;
        const height = this.#canvas.clientHeight || 260;
        const scale = window.devicePixelRatio || 1;
        this.#canvas.width = Math.round(width * scale);
        this.#canvas.height = Math.round(height * scale);

        const thick = 200;
        this.#walls = [
            box(width / 2, height - FLOOR + thick / 2, width + thick * 2, thick, true),
            box(-thick / 2, height / 2, thick, height * 6, true),
            box(width + thick / 2, height / 2, thick, height * 6, true),
        ];
        for (const block of this.#blocks) wake(block);
        this.#draw();
    }

    #start(): void {
        this.#allowed = true;
        if (this.#frame || !this.#visible) return;
        this.#palette = undefined;
        this.#last = performance.now();
        this.#owed = 0;
        const loop = (now: number) => {
            // Catch up in fixed steps, but never try to make up a long pause.
            this.#owed = Math.min(this.#owed + (now - this.#last) / 1000, 0.05);
            this.#last = now;
            const bodies = [...this.#walls, ...this.#blocks];
            while (this.#owed >= TICK) {
                step(bodies, TICK, this.#hold);
                this.#contain();
                this.#owed -= TICK;
            }
            this.#draw();
            // Once every block has come to rest there is nothing left to animate.
            if (this.#blocks.every((block) => block.asleep) && !this.#hold && !this.#near) {
                this.#stop();
                return;
            }
            this.#frame = requestAnimationFrame(loop);
        };
        this.#frame = requestAnimationFrame(loop);
    }

    #stop(): void {
        cancelAnimationFrame(this.#frame);
        this.#frame = 0;
    }

    /** However hard something is pushed or thrown, it stays inside the box. */
    #contain(): void {
        const width = this.#canvas.clientWidth;
        const floor = this.#canvas.clientHeight - FLOOR;
        for (const block of this.#blocks) {
            const reach = Math.abs(Math.cos(block.angle)) * block.hw + Math.abs(Math.sin(block.angle)) * block.hh;
            const tall = Math.abs(Math.sin(block.angle)) * block.hw + Math.abs(Math.cos(block.angle)) * block.hh;
            if (block.y + tall > floor + 2) {
                block.y = floor + 2 - tall;
                block.vy = Math.min(block.vy, 0);
            }
            if (block.x - reach < -2) {
                block.x = reach - 2;
                block.vx = Math.max(block.vx, 0);
            }
            if (block.x + reach > width + 2) {
                block.x = width + 2 - reach;
                block.vx = Math.min(block.vx, 0);
            }
        }
    }

    /** Reads one of the page's color properties as a value a canvas accepts. */
    #color(property: string): string {
        this.style.color = `var(${property})`;
        const resolved = getComputedStyle(this).color;
        this.style.color = "";
        return resolved;
    }

    #draw(): void {
        const context = this.#canvas.getContext("2d");
        if (!context) return;
        const scale = window.devicePixelRatio || 1;
        const width = this.#canvas.width / scale;
        const height = this.#canvas.height / scale;
        context.setTransform(scale, 0, 0, scale, 0, 0);
        context.clearRect(0, 0, width, height);

        // Looking the colors up means restyling the element, so do it once per run.
        this.#palette ??= { floor: this.#color("--rule"), fill: this.#color("--accent"), edge: this.#color("--ground") };
        const { floor, fill, edge } = this.#palette;

        context.fillStyle = floor;
        context.fillRect(0, height - FLOOR, width, FLOOR);

        for (const block of this.#blocks) {
            context.save();
            context.translate(block.x, block.y);
            context.rotate(block.angle);
            context.fillStyle = fill;
            context.fillRect(-block.hw, -block.hh, block.hw * 2, block.hh * 2);
            context.strokeStyle = edge;
            context.lineWidth = 2;
            context.strokeRect(-block.hw + 1, -block.hh + 1, block.hw * 2 - 2, block.hh * 2 - 2);
            context.restore();
        }
    }
}

customElements.define("drop-box", DropBox);
