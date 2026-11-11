// <drop-box>: a small pile of blocks with real physics. Click or tap an empty
// spot to drop something (a block, now and then a ball or a wedge); pick one
// up and throw it. It is drawn in the page's own colors.
//
// The physics is the site's own small engine, physics.ts.

import { World, ball, rect, shape, wake, type Body } from "./physics";

const SIZE = 34;
const MOST = 60;
const FLOOR = 6;
/** The box's top corners are rounded; a slope this size across each keeps blocks out of the part that is cut off. */
const CORNER = 14;
/** Soft colors for the blocks, taken in turn. */
const PASTELS = [350, 25, 70, 130, 190, 250, 300].map((hue) => `oklch(0.86 0.085 ${hue})`);
/** The simulation moves in steps of this many seconds, whatever the screen's refresh rate. */
const TICK = 1 / 120;

class DropBox extends HTMLElement {
    #canvas = document.createElement("canvas");
    // Tuned to feel like blocks with some weight: slower to fall than the
    // engine's default, and trailing the pointer a little when carried.
    #world = Object.assign(new World(), { gravity: 1300, grip: 17, follow: 0.115 });
    #blocks: Body[] = [];
    #colors = new Map<Body, string>();
    #made = 0;
    #walls: Body[] = [];
    #near = false;
    #visible = false;
    #allowed = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    #frame = 0;
    #last = 0;
    #owed = 0;
    #palette?: { floor: string; edge: string };
    #watcher?: IntersectionObserver;
    #resizer?: ResizeObserver;

    connectedCallback(): void {
        const canvas = this.#canvas;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", "A pile of blocks. Click to drop another, or drag one to throw it.");
        this.append(canvas);

        canvas.addEventListener("pointerdown", (event) => {
            // Whatever is under the pointer is picked up; empty space gets something new.
            if (!this.#world.grab([event.offsetX, event.offsetY])) this.#drop(event.offsetX, event.offsetY);
            // Keep hearing about this pointer even if it leaves the box.
            canvas.setPointerCapture(event.pointerId);
            this.#start();
        });
        canvas.addEventListener("pointermove", (event) => {
            this.#world.drag([event.offsetX, event.offsetY]);
        });
        const release = () => this.#world.release();
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
            const block = rect(middle + column * SIZE, floor - SIZE / 2 - row * SIZE, SIZE, SIZE);
            block.asleep = true;
            this.#add(block);
        }
        this.#draw();
    }

    disconnectedCallback(): void {
        this.#stop();
        this.#watcher?.disconnect();
        this.#resizer?.disconnect();
    }

    #drop(x: number, y: number): void {
        const pick = Math.random();
        const half = SIZE / 2;
        const block =
            pick < 0.7 ? rect(x, y, SIZE, SIZE)
            : pick < 0.85 ? ball(x, y, half, { bounce: 0.4 })
            : shape(x, y, [[0, -half], [half * 1.15, half], [-half * 1.15, half]]);
        block.w = (Math.random() - 0.5) * 3;
        this.#add(block);
        if (this.#blocks.length > MOST) {
            const oldest = this.#blocks.shift()!;
            this.#world.remove(oldest);
            this.#colors.delete(oldest);
        }
    }

    #add(block: Body): void {
        this.#colors.set(block, PASTELS[this.#made++ % PASTELS.length]!);
        this.#blocks.push(block);
        this.#world.add(block);
    }

    /** Match the canvas to its box, and put the floor and walls around it. */
    #fit(): void {
        const width = this.clientWidth;
        const height = this.#canvas.clientHeight || 260;
        const scale = window.devicePixelRatio || 1;
        this.#canvas.width = Math.round(width * scale);
        this.#canvas.height = Math.round(height * scale);

        const thick = 200;
        for (const wall of this.#walls) this.#world.remove(wall);
        this.#walls = [
            rect(width / 2, height - FLOOR + thick / 2, width + thick * 2, thick, { fixed: true }),
            rect(-thick / 2, height / 2, thick, height * 6, { fixed: true }),
            rect(width + thick / 2, height / 2, thick, height * 6, { fixed: true }),
            rect(width / 2, -thick / 2, width + thick * 2, thick, { fixed: true }),
            // slopes across the two rounded corners at the top
            shape(CORNER / 3, CORNER / 3, [[0, 0], [CORNER, 0], [0, CORNER]], { fixed: true }),
            shape(width - CORNER / 3, CORNER / 3, [[0, 0], [0, CORNER], [-CORNER, 0]], { fixed: true }),
        ];
        this.#world.add(...this.#walls);
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
            while (this.#owed >= TICK) {
                this.#world.step(TICK);
                this.#contain();
                this.#owed -= TICK;
            }
            this.#draw();
            // Once every block has come to rest there is nothing left to animate.
            if (this.#blocks.every((block) => block.asleep) && !this.#world.holding && !this.#near) {
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
            const xs = block.r ? [block.x - block.r, block.x + block.r] : block.wp.map((corner) => corner[0]);
            const ys = block.r ? [block.y - block.r, block.y + block.r] : block.wp.map((corner) => corner[1]);
            const low = Math.max(...ys) - floor;
            const left = -Math.min(...xs);
            const right = Math.max(...xs) - width;
            const high = -Math.min(...ys);
            if (high > 0) {
                block.y += high;
                block.vy = Math.max(block.vy, 0);
            }
            if (low > 0) {
                block.y -= low;
                block.vy = Math.min(block.vy, 0);
            }
            if (left > 0) {
                block.x += left;
                block.vx = Math.max(block.vx, 0);
            }
            if (right > 0) {
                block.x -= right;
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
        this.#palette ??= { floor: this.#color("--rule"), edge: this.#color("--ground") };
        const { floor, edge } = this.#palette;

        context.fillStyle = floor;
        context.fillRect(0, height - FLOOR, width, FLOOR);

        for (const block of this.#blocks) {
            context.save();
            context.translate(block.x, block.y);
            context.rotate(block.a);
            context.beginPath();
            if (block.r) context.arc(0, 0, block.r, 0, Math.PI * 2);
            else {
                block.p.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
                context.closePath();
            }
            context.fillStyle = this.#colors.get(block) ?? PASTELS[0]!;
            context.fill();
            if (block.r) {
                // a spoke, so a rolling ball can be seen to roll
                context.beginPath();
                context.moveTo(0, 0);
                context.lineTo(block.r, 0);
                context.strokeStyle = edge;
                context.lineWidth = 2;
                context.stroke();
            }
            context.restore();
        }
    }
}

customElements.define("drop-box", DropBox);
