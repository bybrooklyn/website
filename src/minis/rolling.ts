// Rolling: a plain page for watching Mote's marbles roll, a draft and not a mini of its own. Marbles
// are let go one after another at the top of the course in course.ts: down a ramp, round a loop,
// along a banked spiral, into a funnel and through it into a tray, where they come to rest and sleep.
// Drawn flat shaded with Mote's 3D drawing; the look of wood and glass is for later. A click lets
// another marble go at once. The view turns slowly round the whole course; Space or Enter (or
// `?ride` in the address) rides along beside one marble instead, to watch it roll, and takes the
// newest when that one reaches the tray.

import { gl, type Color, type Part } from "../mote/gl";
import { turn, type Solid } from "../mote/space";
import { ball, block, type Mesh, type V3 } from "../mote/solids";
import type { Mote, Scene } from "../mote/stage";
import { RADIUS, makeCourse } from "./course";

export const label = "Marbles rolling down a ramp, round a loop, along a spiral and through a funnel into a tray.";

/** How often a marble is let go, in seconds. */
const EVERY = 0.9;
/**
 * The course is in centimetres and Mote's drawing sees no further than 120 units, made for dice, so it
 * is drawn at a tenth of its size.
 */
const DRAWN = 0.1;
const small = (p: V3): V3 => [p[0] * DRAWN, p[1] * DRAWN, p[2] * DRAWN];
const shrink = (mesh: Mesh): Mesh => ({ ...mesh, points: mesh.points.map(small) });
/** The middle of the course, which the view turns about, and how far off the eye is, as drawn. */
const MIDDLE: V3 = small([8, -10, 28]);
const FAR = 27;

export default function rolling(m: Mote): Scene {
    const course = makeCourse();
    const under = document.createElement("canvas");
    under.className = "mote-gl";
    const view = gl(under);
    if (view) m.canvas.parentElement!.insertBefore(under, m.canvas);
    const shade = (name: string, by = 1): Color => view!.color(m.color(name)).map((value) => value * by) as Color;

    const drawn = new Map<Solid, Part[]>();
    // A marble in two halves, split from pole to pole, each its own colour and turned alike, so that it
    // can be seen to roll and not slide. Each step round a ball's rings is ten faces.
    const whole = ball(RADIUS * DRAWN, 18, 10);
    const halves = [0, 1].map((side): Mesh => ({ ...whole, faces: whole.faces.filter((_, face) => Math.floor(face / 10) < 9 === (side === 0)) }));
    let made = 0;
    const show = (marble: Solid) => {
        if (!view) return;
        // a run of colours round the wheel, so that one marble can be followed
        const hue = (made++ * 47) % 360;
        drawn.set(marble, [view.add(halves[0]!, { color: view.color(`oklch(0.74 0.15 ${hue})`), gloss: 0.6 }), view.add(halves[1]!, { color: view.color(`oklch(0.45 0.12 ${hue})`), gloss: 0.6 })]);
    };
    const forget = (marble: Solid) => {
        for (const part of drawn.get(marble) ?? []) view?.remove(part);
        drawn.delete(marble);
    };
    if (view) {
        for (const piece of course.pieces) view.add(shrink(piece.mesh()), { color: shade("--muted", 0.9), gloss: 0.15 });
        for (const box of course.boxes) {
            const part = view.add(block(small(box.half)), { color: shade("--rule") });
            part.at = small(box.at);
        }
        view.light(small([60, 140, 90]), small([-90, -75, -20]), small([100, 40, 70]), 1.5, 0.6, 0.3);
    }
    const fit = () => view?.size(m.width, m.height);
    fit();

    let [time, wait] = [0, 0];
    let ride = m.link.get("ride") !== null;
    let riding = false;
    let followed: Solid | undefined;
    /** Where the eye is and what it looks at; riding, the eye is eased toward where it should be. */
    let [eye, aim]: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
    const release = () => show(course.release(forget));
    release();
    return {
        step(dt) {
            time += dt;
            wait += dt;
            if (wait >= EVERY) {
                wait -= EVERY;
                release();
            }
            course.space.step(dt);
        },
        press: () => release(),
        keydown(name) {
            if (name === "action") ride = !ride;
        },
        resize: fit,
        resting: () => false,
        debug: () => [`${course.marbles.length} marbles, ${course.marbles.filter((marble) => marble.rest).length} asleep`],
        destroy: () => view?.dispose(),
        draw() {
            if (!view) return;
            if (!followed || !course.marbles.includes(followed) || course.inTray(followed)) followed = course.marbles[course.marbles.length - 1];
            if (ride && followed) {
                // beside and above the marble, a little behind it, eased so that the view does not shake
                const at = small(followed.p);
                const v = followed.v;
                const going = Math.hypot(v[0], v[2]) > 1 ? [v[0] / Math.hypot(v[0], v[2]), v[2] / Math.hypot(v[0], v[2])] : [1, 0];
                const want: V3 = [at[0] - going[0]! * 0.7 + going[1]! * 0.6, at[1] + 0.55, at[2] - going[1]! * 0.7 - going[0]! * 0.6];
                // the first frame of a ride starts there, the rest ease toward it
                const ease = riding ? 0.08 : 1;
                riding = true;
                eye = [eye[0] + (want[0] - eye[0]) * ease, eye[1] + (want[1] - eye[1]) * ease, eye[2] + (want[2] - eye[2]) * ease];
                aim = at;
                view.look(eye, aim, 40);
            } else {
                riding = false;
                const angle = -0.5 + Math.sin(time * 0.05) * 0.6;
                eye = [MIDDLE[0] + Math.sin(angle) * FAR, MIDDLE[1] + 7, MIDDLE[2] + Math.cos(angle) * FAR];
                aim = MIDDLE;
                view.look(eye, aim, 38);
            }
            for (const [marble, parts] of drawn) {
                for (const part of parts) {
                    part.at = small(marble.p);
                    part.turn = turn(marble);
                }
            }
            view.draw();
        },
    };
}
