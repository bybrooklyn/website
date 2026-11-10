// <drop-box>: a small pile of blocks with real physics. Click or tap an empty
// spot to drop another; pick one up and throw it. Blocks stack, tumble and
// come to rest. It is drawn in the page's own colors.
//
// The physics is matter-js, which is only loaded by pages that use this demo.

import Matter from "matter-js";

const { Bodies, Body, Composite, Engine, Mouse, MouseConstraint, Query, Runner, Sleeping } = Matter;

const SIZE = 34;
const MOST = 60;

class DropBox extends HTMLElement {
    #canvas = document.createElement("canvas");
    #engine = Engine.create({ enableSleeping: true });
    #runner = Runner.create();
    #walls: Matter.Body[] = [];
    #frame = 0;
    #visible = false;
    #allowed = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    #holding = false;
    #palette?: { floor: string; fill: string; edge: string };
    #watcher?: IntersectionObserver;
    #resizer?: ResizeObserver;

    connectedCallback(): void {
        this.#canvas.setAttribute("role", "img");
        this.#canvas.setAttribute("aria-label", "A pile of blocks. Click to drop another, or drag one to throw it.");
        this.append(this.#canvas);

        const mouse = Mouse.create(this.#canvas);
        // Let the page scroll when the pointer is over the demo.
        const wheel = (mouse as unknown as { mousewheel: EventListener }).mousewheel;
        this.#canvas.removeEventListener("wheel", wheel);
        const grab = MouseConstraint.create(this.#engine, { mouse, constraint: { stiffness: 0.2 } });
        Composite.add(this.#engine.world, grab);

        // A press that lands on nothing drops a new block there. This listens to
        // the canvas directly: the physics library only reports presses while it
        // is running, and it stops whenever the pile is at rest.
        this.#canvas.addEventListener("pointerdown", (event) => {
            const blocks = Composite.allBodies(this.#engine.world).filter((body) => !body.isStatic);
            const point = { x: event.offsetX, y: event.offsetY };
            if (Query.point(blocks, point).length === 0) this.#drop(point.x, point.y);
            this.#holding = true;
            this.#start();
        });
        addEventListener("pointerup", this.#release);
        addEventListener("pointercancel", this.#release);

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
        const middle = this.#canvas.clientWidth / 2;
        const floor = this.#canvas.clientHeight - 6;
        for (const [column, row] of [[-1, 0], [0, 0], [1, 0], [-0.5, 1], [0.5, 1], [0, 2]] as const) {
            this.#drop(middle + column * SIZE, floor - SIZE / 2 - row * SIZE, false);
        }
        this.#draw();
    }

    #release = (): void => {
        this.#holding = false;
    };

    disconnectedCallback(): void {
        removeEventListener("pointerup", this.#release);
        removeEventListener("pointercancel", this.#release);
        this.#stop();
        this.#watcher?.disconnect();
        this.#resizer?.disconnect();
    }

    #drop(x: number, y: number, awake = true): void {
        const block = Bodies.rectangle(x, y, SIZE, SIZE, { restitution: 0.15, friction: 0.6, density: 0.002 });
        if (awake) Body.setAngularVelocity(block, (Math.random() - 0.5) * 0.12);
        else Sleeping.set(block, true);
        Composite.add(this.#engine.world, block);

        const blocks = Composite.allBodies(this.#engine.world).filter((body) => !body.isStatic);
        if (blocks.length > MOST && blocks[0]) Composite.remove(this.#engine.world, blocks[0]);
    }

    /** Match the canvas to its box, and rebuild the floor and walls around it. */
    #fit(): void {
        const width = this.clientWidth;
        const height = this.#canvas.clientHeight || 260;
        const scale = window.devicePixelRatio || 1;
        this.#canvas.width = Math.round(width * scale);
        this.#canvas.height = Math.round(height * scale);

        Composite.remove(this.#engine.world, this.#walls);
        const thick = 80;
        this.#walls = [
            Bodies.rectangle(width / 2, height - 6 + thick / 2, width + thick * 2, thick, { isStatic: true }),
            Bodies.rectangle(-thick / 2, height / 2, thick, height * 4, { isStatic: true }),
            Bodies.rectangle(width + thick / 2, height / 2, thick, height * 4, { isStatic: true }),
        ];
        Composite.add(this.#engine.world, this.#walls);
        this.#draw();
    }

    #start(): void {
        this.#allowed = true;
        if (this.#frame || !this.#visible) return;
        this.#palette = undefined;
        Runner.run(this.#runner, this.#engine);
        const loop = () => {
            this.#draw();
            // Once every block has come to rest there is nothing left to animate.
            const blocks = Composite.allBodies(this.#engine.world).filter((body) => !body.isStatic);
            if (blocks.every((body) => body.isSleeping) && !this.#holding) {
                this.#stop();
                return;
            }
            this.#frame = requestAnimationFrame(loop);
        };
        this.#frame = requestAnimationFrame(loop);
    }

    #stop(): void {
        Runner.stop(this.#runner);
        cancelAnimationFrame(this.#frame);
        this.#frame = 0;
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
        context.fillRect(0, height - 6, width, 6);

        for (const body of Composite.allBodies(this.#engine.world)) {
            if (body.isStatic) continue;
            context.save();
            context.translate(body.position.x, body.position.y);
            context.rotate(body.angle);
            context.fillStyle = fill;
            context.fillRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
            context.strokeStyle = edge;
            context.lineWidth = 2;
            context.strokeRect(-SIZE / 2 + 1, -SIZE / 2 + 1, SIZE - 2, SIZE - 2);
            context.restore();
        }
    }
}

customElements.define("drop-box", DropBox);
