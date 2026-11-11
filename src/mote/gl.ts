// Mote's 3D drawing: solids of flat faces, drawn by the graphics card with
// real depth, so nothing shows through anything, one sun with shadows, light
// from the sky, and a picture (a number, say) on a face. WebGL 2, no library.
//
//   const view = gl(canvas);                      // undefined where WebGL 2 is missing
//   const die = view.add(mesh, { color: view.color("oklch(0.8 0.12 300)"), marks: (face) => String(face + 1) });
//   view.look([8, 10, 19], [0, 4, 0], 30);
//   die.at = [0, 1, 0]; die.turn = turn;
//   view.draw();

import { cross, dot3 as dot, minus, upright, type Mesh, type Turn, type V3 } from "./solids";

export type Color = [r: number, g: number, b: number];

export interface Look {
    color: Color;
    /** Less than 1 is see-through: drawn last, and casts no shadow. */
    alpha?: number;
    /** Casts a shadow, and has shadows fall on it. Both true unless said. */
    casts?: boolean;
    shaded?: boolean;
    /**
     * What to write on a face, if anything: one word in its middle, or several, each toward one of the
     * face's corners (as a four-sided die has a number at every corner). Each has a group, a number
     * that `lit` on the part can name to light it up; a single word's group is the face's number.
     */
    marks?(face: number): string | Mark[] | undefined;
    ink?: Color;
}

export interface Mark {
    word: string;
    group: number;
    /** Which of the face's corners it sits toward, and reads upright toward. Left out, it is in the middle. */
    corner?: number;
}

export interface Part {
    at: V3;
    turn: Turn;
    hidden: boolean;
    /** The group of marks to light up, and how far it is lit, from 0 to 1. */
    lit: number;
    shine: number;
}

interface Drawn extends Part {
    look: Look;
    faces: WebGLVertexArrayObject;
    count: number;
    marks?: WebGLVertexArrayObject;
    markCount: number;
}

export interface View {
    add(mesh: Mesh, look: Look): Part;
    remove(part: Part): void;
    /** Where the eye is, what it looks at, and how wide it sees, in degrees up and down. */
    look(from: V3, to: V3, degrees: number): void;
    /** Where the sun is, the box it has to light (two opposite corners), and how bright the sun, the sky and the ground are. */
    light(from: V3, low: V3, high: V3, sun?: number, sky?: number, ground?: number): void;
    /** Fit the drawing to a size in CSS pixels. */
    size(width: number, height: number): void;
    draw(): void;
    /** A color as the page writes it, as numbers. */
    color(css: string): Color;
    /** The face numbers and words are written in. */
    font: string;
}

const VERTEX = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
layout(location = 3) in float group;
uniform mat4 model, eye, sun;
out vec3 facing;
out vec4 lit;
out vec2 at;
out float which;
void main() {
    vec4 world = model * vec4(position, 1.0);
    facing = mat3(model) * normal;
    lit = sun * world;
    at = uv;
    which = group;
    gl_Position = eye * world;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 facing;
in vec4 lit;
in vec2 at;
in float which;
uniform vec4 color;
uniform vec3 toSun, levels;
uniform bool marked, shaded;
uniform float glow, shine;
uniform sampler2DShadow shadow;
uniform sampler2D marks;
out vec4 result;
void main() {
    vec3 n = normalize(gl_FrontFacing ? facing : -facing);
    vec4 base = color;
    if (marked) {
        base.a *= texture(marks, at).a;
        if (base.a < 0.02) discard;
    }
    float open = 1.0;
    if (shaded) {
        // in shadow if something is nearer the sun: looked up nine times around the point, for a soft edge
        vec3 p = lit.xyz / lit.w * 0.5 + 0.5;
        if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0 && p.z < 1.0) {
            vec2 texel = 1.0 / vec2(textureSize(shadow, 0));
            float slope = 1.0 - max(dot(n, toSun), 0.0);
            float sum = 0.0;
            for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) sum += texture(shadow, vec3(p.xy + vec2(x, y) * texel * 1.5, p.z - 0.0012 - 0.004 * slope));
            open = sum / 9.0;
        }
    }
    // the sun, by how squarely the face meets it, and light from the sky above and the ground below
    float bright = levels.x * max(dot(n, toSun), 0.0) * open + mix(levels.z, levels.y, n.y * 0.5 + 0.5);
    vec3 seen = pow(pow(base.rgb, vec3(2.2)) * bright, vec3(1.0 / 2.2));
    // a mark that is lit shows white, and by its own light
    if (marked && abs(which - glow) < 0.5) seen = mix(seen, vec3(1.0), shine);
    result = vec4(seen, base.a);
}`;

const DEPTH_VERTEX = `#version 300 es
layout(location = 0) in vec3 position;
uniform mat4 model, sun;
void main() { gl_Position = sun * model * vec4(position, 1.0); }`;
const DEPTH_FRAGMENT = `#version 300 es
void main() {}`;

// ---- four-by-four matrices, column by column as the graphics card wants them ----

type M4 = Float32Array;

function times(a: M4, b: M4): M4 {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!;
    return out;
}

const unit = (a: V3): V3 => {
    const long = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / long, a[1] / long, a[2] / long];
};

/** The world as seen from `from`, looking at `to`. */
function facingMatrix(from: V3, to: V3): M4 {
    const back = unit(minus(from, to));
    const right = unit(cross(Math.abs(back[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0], back));
    const up = cross(back, right);
    return new Float32Array([right[0], up[0], back[0], 0, right[1], up[1], back[1], 0, right[2], up[2], back[2], 0, -dot(right, from), -dot(up, from), -dot(back, from), 1]);
}

function perspective(degrees: number, aspect: number, near: number, far: number): M4 {
    const f = 1 / Math.tan((degrees * Math.PI) / 360);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
}

function box(left: number, right: number, bottom: number, top: number, near: number, far: number): M4 {
    return new Float32Array([2 / (right - left), 0, 0, 0, 0, 2 / (top - bottom), 0, 0, 0, 0, -2 / (far - near), 0, -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1]);
}

const placed = (at: V3, turn: Turn): M4 =>
    new Float32Array([turn[0][0], turn[1][0], turn[2][0], 0, turn[0][1], turn[1][1], turn[2][1], 0, turn[0][2], turn[1][2], turn[2][2], 0, at[0], at[1], at[2], 1]);

/** Sets a canvas up for drawing in 3D. Returns nothing where the browser cannot. */
export function gl(canvas: HTMLCanvasElement): View | undefined {
    const g = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!g) return undefined;

    const program = (vertex: string, fragment: string) => {
        const made = g.createProgram();
        for (const [kind, source] of [[g.VERTEX_SHADER, vertex], [g.FRAGMENT_SHADER, fragment]] as const) {
            const shader = g.createShader(kind)!;
            g.shaderSource(shader, source);
            g.compileShader(shader);
            if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(shader) ?? "A shader did not compile.");
            g.attachShader(made, shader);
        }
        g.linkProgram(made);
        const names = new Map<string, WebGLUniformLocation | null>();
        return { made, at: (name: string) => names.get(name) ?? (names.set(name, g.getUniformLocation(made, name)), names.get(name)!) };
    };
    let main: ReturnType<typeof program>, depth: ReturnType<typeof program>;
    try {
        main = program(VERTEX, FRAGMENT);
        depth = program(DEPTH_VERTEX, DEPTH_FRAGMENT);
    } catch (problem) {
        console.error("Mote could not set up 3D drawing:", problem);
        return undefined;
    }

    // where shadows are worked out: how far each thing is from the sun, seen from the sun
    const SHADOW = 2048;
    const shadow = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, shadow);
    g.texImage2D(g.TEXTURE_2D, 0, g.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, g.DEPTH_COMPONENT, g.UNSIGNED_INT, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_COMPARE_MODE, g.COMPARE_REF_TO_TEXTURE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_COMPARE_FUNC, g.LEQUAL);
    const frame = g.createFramebuffer();
    g.bindFramebuffer(g.FRAMEBUFFER, frame);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.TEXTURE_2D, shadow, 0);
    g.bindFramebuffer(g.FRAMEBUFFER, null);

    // what is written on faces: every different word once, side by side in one picture
    const CELL = 128;
    const ACROSS = 8;
    const sheet = document.createElement("canvas");
    sheet.width = CELL * ACROSS;
    sheet.height = CELL * ACROSS;
    const pen = sheet.getContext("2d")!;
    const written = new Map<string, number>();
    const marks = g.createTexture();
    let stale = true;

    const parts: Drawn[] = [];
    let [eyeFrom, eyeTo, eyeDegrees]: [V3, V3, number] = [[0, 5, 20], [0, 0, 0], 30];
    let sunMatrix: M4 = new Float32Array(16);
    let toSun: V3 = [0, 1, 0];
    let levels: [number, number, number] = [1.6, 0.75, 0.3];
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;

    const filled = (data: number[], sizes: number[]): WebGLVertexArrayObject => {
        const array = g.createVertexArray();
        g.bindVertexArray(array);
        g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
        g.bufferData(g.ARRAY_BUFFER, new Float32Array(data), g.STATIC_DRAW);
        const stride = sizes.reduce((sum, size) => sum + size, 0) * 4;
        let offset = 0;
        sizes.forEach((size, index) => {
            g.enableVertexAttribArray(index);
            g.vertexAttribPointer(index, size, g.FLOAT, false, stride, offset);
            offset += size * 4;
        });
        g.bindVertexArray(null);
        return array;
    };

    const view: View = {
        font: "serif",
        color(css) {
            // The page gives colors in forms the graphics card cannot read, so a canvas reads them first.
            probe.clearRect(0, 0, 1, 1);
            probe.fillStyle = css;
            probe.fillRect(0, 0, 1, 1);
            const [r, gg, b] = probe.getImageData(0, 0, 1, 1).data;
            return [r! / 255, gg! / 255, b! / 255];
        },
        add(mesh, look) {
            const faces: number[] = [];
            const words: number[] = [];
            mesh.faces.forEach((face, number) => {
                const corners = face.map((corner) => mesh.points[corner]!);
                const n = unit(cross(minus(corners[1]!, corners[0]!), minus(corners[2]!, corners[0]!)));
                // each face as a fan of triangles, all facing the way the face does
                for (let i = 1; i + 1 < corners.length; i++) for (const corner of [corners[0]!, corners[i]!, corners[i + 1]!]) faces.push(...corner, ...n, 0, 0);
                const asked = look.marks?.(number);
                if (!asked) return;
                const middle = corners.reduce((sum, corner): V3 => [sum[0] + corner[0] / corners.length, sum[1] + corner[1] / corners.length, sum[2] + corner[2] / corners.length], [0, 0, 0] as V3);
                // as big as the face allows: a little under the distance from its middle to its nearest edge
                const room = Math.min(...corners.map((corner, i) => {
                    const along = unit(minus(corners[(i + 1) % corners.length]!, corner));
                    const to = minus(middle, corner);
                    return Math.hypot(...minus(to, along.map((value) => value * dot(to, along)) as V3));
                })) * 0.78;
                for (const mark of typeof asked === "string" ? [{ word: asked, group: number } as Mark] : asked) {
                    let cell = written.get(mark.word);
                    if (cell === undefined) {
                        cell = written.size;
                        written.set(mark.word, cell);
                        const [x, y] = [(cell % ACROSS) * CELL, Math.floor(cell / ACROSS) * CELL];
                        pen.font = `700 ${mark.word.length > 1 ? 74 : 88}px ${view.font}`;
                        pen.textAlign = "center";
                        pen.textBaseline = "middle";
                        pen.fillStyle = "#fff";
                        pen.fillText(mark.word, x + CELL / 2, y + CELL / 2 + 6);
                        // a line under 6 and 9, so that they can be told apart
                        if (mark.word === "6" || mark.word === "9") pen.fillRect(x + 40, y + 108, 48, 7);
                        stale = true;
                    }
                    // upright toward a corner of the face (its first, unless one is named), and a hair above the face;
                    // one that sits toward a corner is smaller, and part of the way out to it
                    const toward = minus(corners[mark.corner ?? 0]!, middle);
                    const up = unit(toward);
                    const right = cross(up, n);
                    const [size, out] = mark.corner === undefined ? [room, 0] : [room * 0.5, 0.42];
                    const [u, v] = [(cell % ACROSS) / ACROSS, Math.floor(cell / ACROSS) / ACROSS];
                    const corner = (x: number, y: number) => [
                        ...([0, 1, 2].map((axis) => middle[axis]! + toward[axis]! * out + right[axis]! * x * size + up[axis]! * y * size + n[axis]! * 0.002)),
                        ...n, u + ((x + 1) / 2) / ACROSS, v + ((1 - y) / 2) / ACROSS, mark.group,
                    ];
                    words.push(...corner(-1, -1), ...corner(1, -1), ...corner(1, 1), ...corner(-1, -1), ...corner(1, 1), ...corner(-1, 1));
                }
            });
            const part: Drawn = {
                at: [0, 0, 0], turn: upright(), hidden: false, lit: -1, shine: 0, look,
                faces: filled(faces, [3, 3, 2]), count: faces.length / 8,
                marks: words.length ? filled(words, [3, 3, 2, 1]) : undefined, markCount: words.length / 9,
            };
            parts.push(part);
            return part;
        },
        remove(part) {
            const at = parts.indexOf(part as Drawn);
            if (at >= 0) parts.splice(at, 1);
        },
        look(from, to, degrees) {
            [eyeFrom, eyeTo, eyeDegrees] = [from, to, degrees];
        },
        light(from, low, high, sun = 1.6, sky = 0.75, ground = 0.3) {
            const middle: V3 = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
            toSun = unit(minus(from, middle));
            const seen = facingMatrix(from, middle);
            // the box, seen from the sun: the least and most of its eight corners each way
            const [least, most] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
            for (const x of [low[0], high[0]]) for (const y of [low[1], high[1]]) for (const z of [low[2], high[2]]) {
                for (let axis = 0; axis < 3; axis++) {
                    const along = seen[axis]! * x + seen[4 + axis]! * y + seen[8 + axis]! * z + seen[12 + axis]!;
                    least[axis] = Math.min(least[axis]!, along);
                    most[axis] = Math.max(most[axis]!, along);
                }
            }
            sunMatrix = times(box(least[0]!, most[0]!, least[1]!, most[1]!, -most[2]! - 1, -least[2]! + 1), seen);
            levels = [sun, sky, ground];
        },
        size(width, height) {
            const scale = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
        },
        draw() {
            if (stale) {
                g.bindTexture(g.TEXTURE_2D, marks);
                g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, sheet);
                g.generateMipmap(g.TEXTURE_2D);
                g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
                stale = false;
            }
            const shown = parts.filter((part) => !part.hidden);
            const models = new Map(shown.map((part) => [part, placed(part.at, part.turn)]));
            g.enable(g.DEPTH_TEST);

            // first, from the sun: how far away the nearest thing is, everywhere it looks
            g.bindFramebuffer(g.FRAMEBUFFER, frame);
            g.viewport(0, 0, SHADOW, SHADOW);
            g.clear(g.DEPTH_BUFFER_BIT);
            g.useProgram(depth.made);
            g.uniformMatrix4fv(depth.at("sun"), false, sunMatrix);
            g.disable(g.BLEND);
            g.depthMask(true);
            for (const part of shown) {
                if (part.look.casts === false || (part.look.alpha ?? 1) < 1) continue;
                g.uniformMatrix4fv(depth.at("model"), false, models.get(part)!);
                g.bindVertexArray(part.faces);
                g.drawArrays(g.TRIANGLES, 0, part.count);
            }

            // then from the eye
            g.bindFramebuffer(g.FRAMEBUFFER, null);
            g.viewport(0, 0, canvas.width, canvas.height);
            g.clearColor(0, 0, 0, 0);
            g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
            g.useProgram(main.made);
            g.uniformMatrix4fv(main.at("eye"), false, times(perspective(eyeDegrees, canvas.width / canvas.height, 0.5, 120), facingMatrix(eyeFrom, eyeTo)));
            g.uniformMatrix4fv(main.at("sun"), false, sunMatrix);
            g.uniform3fv(main.at("toSun"), toSun);
            g.uniform3fv(main.at("levels"), levels);
            g.activeTexture(g.TEXTURE0);
            g.bindTexture(g.TEXTURE_2D, shadow);
            g.uniform1i(main.at("shadow"), 0);
            g.activeTexture(g.TEXTURE1);
            g.bindTexture(g.TEXTURE_2D, marks);
            g.uniform1i(main.at("marks"), 1);

            const paint = (part: Drawn, marked: boolean) => {
                g.uniformMatrix4fv(main.at("model"), false, models.get(part)!);
                g.uniform4f(main.at("color"), ...(marked ? (part.look.ink ?? [0.1, 0.06, 0.14]) : part.look.color), marked ? 1 : (part.look.alpha ?? 1));
                g.uniform1i(main.at("marked"), marked ? 1 : 0);
                g.uniform1f(main.at("glow"), part.lit);
                g.uniform1f(main.at("shine"), part.shine);
                g.uniform1i(main.at("shaded"), part.look.shaded === false ? 0 : 1);
                g.bindVertexArray(marked ? part.marks! : part.faces);
                g.drawArrays(g.TRIANGLES, 0, marked ? part.markCount : part.count);
            };
            // what is solid, then what is written on it, then what can be seen through
            for (const part of shown) if ((part.look.alpha ?? 1) >= 1) paint(part, false);
            g.enable(g.BLEND);
            g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
            g.depthMask(false);
            g.enable(g.POLYGON_OFFSET_FILL);
            g.polygonOffset(-2, -2);
            for (const part of shown) if (part.marks) paint(part, true);
            g.disable(g.POLYGON_OFFSET_FILL);
            for (const part of shown) if ((part.look.alpha ?? 1) < 1) paint(part, false);
            g.depthMask(true);
            g.bindVertexArray(null);
        },
    };
    return view;
}
