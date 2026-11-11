// Mote's 2D physics: bodies, contacts and joints. The solving is Mote's fork
// of planck (forks/planck, a port of Box2D); this file is the small part a
// mini actually touches. A mini works in pixels with y pointing down, and
// everything here converts to and from the meters the solver likes.
//
//   const flat = new Flat();
//   const crate = flat.box(100, 40, 40, 40);
//   flat.wall([[0, 300], [600, 300]]);
//   flat.hand.take(x, y); flat.hand.move(x, y); flat.hand.drop();
//   flat.step(dt);
//   flat.trace(ctx, crate); ctx.fill();

import { Box, Chain, Circle, DistanceJoint, MotorJoint, MouseJoint, Polygon, RevoluteJoint, RopeJoint, Vec2, World, type Body, type Joint } from "./forks/planck/planck.js";

export type { Body, Joint };
export type P = [number, number];

/** How many pixels a meter is. The solver is at its best with things between a tenth of a meter and ten. */
const UNIT = 40;

export interface Stuff {
    /** Does not move. */
    fixed?: boolean;
    angle?: number;
    /** How heavy for its size, against the usual 1. */
    density?: number;
    friction?: number;
    bounce?: number;
    /** Never turns. */
    upright?: boolean;
    /** Moves fast enough to need checking between steps, so that it cannot pass through a thin wall. */
    quick?: boolean;
}

export class Flat {
    readonly world: World;
    /** Stands for "the world" at one end of a joint. */
    readonly ground: Body;
    /** Picks things up, carries them and throws them. */
    readonly hand: Hand;
    #owed = 0;
    /** How many times each step goes over the speeds, and over the positions. Things joined in a long line want more. */
    care: [number, number] = [8, 3];

    /** `gravity` is in pixels per second, each second. */
    constructor(gravity = 2600) {
        this.world = new World({ gravity: new Vec2(0, gravity / UNIT) });
        this.ground = this.world.createBody();
        this.hand = new Hand(this);
    }

    #body(x: number, y: number, stuff: Stuff): Body {
        return this.world.createBody({
            type: stuff.fixed ? "static" : "dynamic",
            position: new Vec2(x / UNIT, y / UNIT),
            angle: stuff.angle ?? 0,
            fixedRotation: stuff.upright ?? false,
            bullet: stuff.quick ?? false,
        });
    }

    #fix(body: Body, shape: Box | Circle | Polygon, stuff: Stuff): Body {
        body.createFixture({ shape, density: stuff.density ?? 1, friction: stuff.friction ?? 0.6, restitution: stuff.bounce ?? 0 });
        return body;
    }

    box(x: number, y: number, w: number, h: number, stuff: Stuff = {}): Body {
        return this.#fix(this.#body(x, y, stuff), new Box(w / 2 / UNIT, h / 2 / UNIT), stuff);
    }

    ball(x: number, y: number, r: number, stuff: Stuff = {}): Body {
        return this.#fix(this.#body(x, y, stuff), new Circle(r / UNIT), stuff);
    }

    /** Any shape that bulges everywhere, from its corners around its own middle. */
    shape(x: number, y: number, corners: P[], stuff: Stuff = {}): Body {
        return this.#fix(this.#body(x, y, stuff), new Polygon(corners.map(([px, py]) => new Vec2(px / UNIT, py / UNIT))), stuff);
    }

    /** A wall that does not move, along a line of points. With `loop` its end is joined to its start. */
    wall(points: P[], loop = false, friction = 0.6): Body {
        const body = this.world.createBody();
        body.createFixture({ shape: new Chain(points.map(([x, y]) => new Vec2(x / UNIT, y / UNIT)), loop), friction });
        return body;
    }

    remove(thing: Body | Joint): void {
        if ("getBodyA" in thing) this.world.destroyJoint(thing);
        else this.world.destroyBody(thing);
    }

    /** Pins two bodies together at a point, so that they turn about it. */
    pin(a: Body, b: Body, x: number, y: number): Joint {
        return this.world.createJoint(new RevoluteJoint({}, a, b, new Vec2(x / UNIT, y / UNIT)))!;
    }

    /** Holds two points, one on each body, a fixed distance apart: a rod. */
    rod(a: Body, b: Body, onA: P, onB: P): Joint {
        return this.world.createJoint(new DistanceJoint({}, a, b, new Vec2(onA[0] / UNIT, onA[1] / UNIT), new Vec2(onB[0] / UNIT, onB[1] / UNIT)))!;
    }

    /** Lets two points come together but never get further apart than `length`: a rope. Points are measured from each body's middle. */
    rope(a: Body, b: Body, length: number, onA: P = [0, 0], onB: P = [0, 0]): Joint {
        return this.world.createJoint(new RopeJoint({ maxLength: length / UNIT, localAnchorA: new Vec2(onA[0] / UNIT, onA[1] / UNIT), localAnchorB: new Vec2(onB[0] / UNIT, onB[1] / UNIT), bodyA: a, bodyB: b }))!;
    }

    /**
     * A motor: pushes `b` toward a place measured from `a`'s middle, and pushes `a` back just as hard.
     * `strength` is how hard, in multiples of what `a` weighs. Call `to` on what is returned to say
     * where. The two pass through each other. This is an arm holding a tool: press the tool against
     * something and it is the body that moves.
     */
    motor(a: Body, b: Body, strength: number): { to(dx: number, dy: number): void } {
        const joint = this.world.createJoint(new MotorJoint({ maxForce: strength * a.getMass() * this.world.getGravity().length(), maxTorque: 0, correctionFactor: 0.25 }, a, b))!;
        return {
            to: (dx, dy) => {
                a.setAwake(true);
                joint.setLinearOffset(new Vec2(dx / UNIT, dy / UNIT));
            },
        };
    }

    /** The body under a point, if one that can move is there. */
    at(x: number, y: number): Body | undefined {
        const point = new Vec2(x / UNIT, y / UNIT);
        let found: Body | undefined;
        this.world.queryAABB({ lowerBound: point, upperBound: point }, (fixture) => {
            if (!fixture.getBody().isDynamic() || !fixture.testPoint(point)) return true;
            found = fixture.getBody();
            return false;
        });
        return found;
    }

    /** Moves everything on by `dt` seconds, in steps of 1/120. */
    step(dt: number): void {
        this.#owed += dt;
        while (this.#owed >= 1 / 120 - 1e-9) {
            this.world.step(1 / 120, this.care[0], this.care[1]);
            this.#owed -= 1 / 120;
        }
    }

    /** Whether everything that can move has come to rest. */
    get still(): boolean {
        for (let body = this.world.getBodyList(); body; body = body.getNext()) if (body.isDynamic() && body.isAwake()) return false;
        return true;
    }
}

/** Where a body is, in pixels, and how far it has turned. */
export const where = (body: Body): { x: number; y: number; a: number } => ({ x: body.getPosition().x * UNIT, y: body.getPosition().y * UNIT, a: body.getAngle() });

/** How fast a body is going, in pixels a second. */
export const speed = (body: Body): number => body.getLinearVelocity().length() * UNIT;

/** Gives a body a speed, in pixels a second, and a spin. */
export function send(body: Body, vx: number, vy: number, spin = body.getAngularVelocity()): void {
    body.setAwake(true);
    body.setLinearVelocity(new Vec2(vx / UNIT, vy / UNIT));
    body.setAngularVelocity(spin);
}

/** Lays a body's outline on a canvas as a path, ready to be filled or stroked. */
export function trace(ctx: CanvasRenderingContext2D, body: Body): void {
    const { x, y, a } = where(body);
    const [c, s] = [Math.cos(a), Math.sin(a)];
    ctx.beginPath();
    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
        const shape = fixture.getShape();
        if (shape instanceof Circle) {
            ctx.moveTo(x + shape.getRadius() * UNIT, y);
            ctx.arc(x, y, shape.getRadius() * UNIT, 0, Math.PI * 2);
        } else if (shape instanceof Polygon) {
            shape.m_vertices.forEach((corner, index) => {
                const [px, py] = [x + (corner.x * c - corner.y * s) * UNIT, y + (corner.x * s + corner.y * c) * UNIT];
                if (index) ctx.lineTo(px, py);
                else ctx.moveTo(px, py);
            });
            ctx.closePath();
        }
    }
}

/** How far a ball reaches from its middle, in pixels; 0 for anything else. */
export function radius(body: Body): number {
    const shape = body.getFixtureList()?.getShape();
    return shape instanceof Circle ? shape.getRadius() * UNIT : 0;
}

class Hand {
    #joint?: MouseJoint;
    held?: Body;
    /** How hard it can pull, in multiples of what it holds weighs. */
    strength = 40;

    constructor(readonly flat: Flat) {}

    /** Takes hold of whatever is under the point, or of `body` if one is given. Returns what it took. */
    take(x: number, y: number, body = this.flat.at(x, y)): Body | undefined {
        this.drop();
        if (!body) return undefined;
        const target = new Vec2(x / UNIT, y / UNIT);
        this.#joint = this.flat.world.createJoint(new MouseJoint({ maxForce: this.strength * body.getMass() * this.flat.world.getGravity().length(), frequencyHz: 7, dampingRatio: 0.9 }, this.flat.ground, body, target))!;
        this.held = body;
        body.setAwake(true);
        return body;
    }

    move(x: number, y: number): void {
        this.#joint?.setTarget(new Vec2(x / UNIT, y / UNIT));
    }

    drop(): void {
        if (this.#joint) this.flat.world.destroyJoint(this.#joint);
        this.#joint = undefined;
        this.held = undefined;
    }
}
