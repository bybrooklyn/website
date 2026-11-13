// Mote's 3D drawing: solids of flat faces, drawn by the graphics card with
// real depth, so nothing shows through anything, one sun with shadows, light
// from the sky, and a picture (a number, say) on a face. What shines by its own
// light bleeds a little of it around itself. WebGL 2, no library.
//
//   const view = gl(canvas);                      // undefined where WebGL 2 is missing
//   const die = view.add(mesh, { color: view.color("oklch(0.8 0.12 300)"), marks: (face) => String(face + 1) });
//   view.look([8, 10, 19], [0, 4, 0], 30);
//   die.at = [0, 1, 0]; die.turn = turn;
//   view.draw();

import { cross, dot3 as dot, minus, plus, scaled, upright, type Mesh, type Turn, type V3 } from "./solids";

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
    /** Drawn after everything else and in front of it, above the shade (see `View.shade`). */
    over?: boolean;
    /** How shiny: from 0, dull, to 1, a bright spot where the sun glances off it toward the eye. Dull unless said. */
    gloss?: number;
    /** Only what is written on it is drawn, not its faces: for words on something round, written on an unseen box around it. */
    bare?: boolean;
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
    /** How many times the size it was made. */
    scale: number;
    /** How strongly it shines by its own light, from 0. What shines is not shaded, and bleeds light around itself. */
    emit: number;
}

/**
 * What a part is drawn from, on the graphics card: its faces and the words on them. Parts made from
 * the same mesh with the same words share one, and it is freed once no part uses it.
 */
interface Shape {
    faces: Float32Array;
    words: Float32Array;
    facesArray?: WebGLVertexArrayObject;
    facesBuffer?: WebGLBuffer;
    marksArray?: WebGLVertexArrayObject;
    marksBuffer?: WebGLBuffer;
    count: number;
    markCount: number;
    /** The cells of the sheet its words are written in. */
    cells: number[];
    /** How many parts are drawn from it now. */
    users: number;
    /** Where it is kept, to be found again and to be forgotten when freed. */
    home: Map<string, Shape>;
    key: string;
}

interface Drawn extends Part {
    look: Look;
    shape: Shape;
}

export interface View {
    add(mesh: Mesh, look: Look): Part;
    /** A flat card with words on it, one unit high and facing +z until it is turned. Drawn over everything. */
    sign(words: string, color: Color): Part;
    remove(part: Part): void;
    /** Where the eye is, what it looks at, and how wide it sees, in degrees up and down. */
    look(from: V3, to: V3, degrees: number): void;
    /** The turn that faces a sign squarely at the eye. */
    facing(): Turn;
    /** The place `far` in front of the eye that is seen at (x, y), each from -1 at one edge of the picture to 1 at the other. */
    ahead(x: number, y: number, far: number): V3;
    /** How far everything is darkened, from 0 to 1, except what is drawn `over`. */
    shade: number;
    /** Where the sun is, the box it has to light (two opposite corners), and how bright the sun, the sky and the ground are. */
    light(from: V3, low: V3, high: V3, sun?: number, sky?: number, ground?: number): void;
    /** Fit the drawing to a size in CSS pixels. */
    size(width: number, height: number): void;
    draw(): void;
    /** A color as the page writes it, as numbers. */
    color(css: string): Color;
    /** The face numbers and words are written in. */
    font: string;
    /** Frees everything on the graphics card and lets the context go. The view draws nothing after. */
    dispose(): void;
}

/** Where a word sits on a face: the face's middle, the way the face looks, the way the word's top points, and half the word's size. */
export function seat(mesh: Mesh, face: number): { middle: V3; out: V3; up: V3; room: number } {
    const corners = mesh.faces[face]!.map((corner) => mesh.points[corner]!);
    const middle = corners.reduce<V3>((sum, corner) => plus(sum, scaled(corner, 1 / corners.length)), [0, 0, 0]);
    // as big as the face allows: a little under the distance from its middle to its nearest edge
    const room = Math.min(...corners.map((corner, i) => {
        const along = unit(minus(corners[(i + 1) % corners.length]!, corner));
        const to = minus(middle, corner);
        return Math.hypot(...minus(to, scaled(along, dot(to, along))));
    })) * 0.78;
    return { middle, out: unit(cross(minus(corners[1]!, corners[0]!), minus(corners[2]!, corners[0]!))), up: unit(minus(corners[0]!, middle)), room };
}

const VERTEX = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
layout(location = 3) in float group;
uniform mat4 model, eye, sun;
out vec3 facing, where;
out vec4 lit;
out vec2 at;
out float which;
void main() {
    vec4 world = model * vec4(position, 1.0);
    facing = mat3(model) * normal;
    where = world.xyz;
    lit = sun * world;
    at = uv;
    which = group;
    gl_Position = eye * world;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 facing, where;
in vec4 lit;
in vec2 at;
in float which;
uniform vec4 color;
uniform vec3 toSun, levels, eyeAt;
uniform float gloss;
uniform bool marked, shaded;
uniform float glow, shine, emit;
uniform bool glowing;
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
    // the sun's glint on something shiny: brightest where the face looks halfway between the sun and the eye
    if (gloss > 0.0 && !marked) seen += gloss * open * pow(max(dot(n, normalize(toSun + normalize(eyeAt - where))), 0.0), 48.0);
    // a mark that is lit shows white, and by its own light; so does anything that shines, in its own color
    float white = marked && abs(which - glow) < 0.5 ? shine : 0.0;
    if (glowing) {
        // the picture of only what shines: everything else is black, and hides what shines behind it
        if (base.a < 0.5) discard;
        vec3 light = mix(base.rgb * emit, vec3(1.0), white);
        result = vec4(light, max(light.r, max(light.g, light.b)));
        return;
    }
    seen = mix(mix(seen, base.rgb, min(emit, 1.0)), vec3(1.0), white);
    result = vec4(seen, base.a);
}`;

// The whole picture as one triangle: to blur what shines, to lay it over the scene, and to darken the scene.
const SCREEN_VERTEX = `#version 300 es
out vec2 at;
void main() {
    at = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(at * 2.0 - 1.0, 0.0, 1.0);
}`;
const SCREEN_FRAGMENT = `#version 300 es
precision highp float;
in vec2 at;
uniform sampler2D from;
uniform vec2 stride;
uniform vec4 tint;
uniform float gain;
out vec4 result;
void main() {
    if (gain == 0.0) { result = tint; return; }
    const float weights[5] = float[](0.227, 0.1945, 0.1216, 0.054, 0.0162);
    vec4 sum = texture(from, at) * weights[0];
    for (int i = 1; i < 5; i++) sum += (texture(from, at + stride * float(i)) + texture(from, at - stride * float(i))) * weights[i];
    result = sum * gain;
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

const placed = (at: V3, turn: Turn, by: number): M4 =>
    new Float32Array([turn[0][0] * by, turn[1][0] * by, turn[2][0] * by, 0, turn[0][1] * by, turn[1][1] * by, turn[2][1] * by, 0, turn[0][2] * by, turn[1][2] * by, turn[2][2] * by, 0, at[0], at[1], at[2], 1]);

/** A shader program, and where each of its inputs is, looked up once. */
type Program = { made: WebGLProgram; at(name: string): WebGLUniformLocation | null };

/** Sets a canvas up for drawing in 3D. Returns nothing where the browser cannot. */
export function gl(canvas: HTMLCanvasElement): View | undefined {
    // The picture's colors are kept already multiplied by how solid they are, which is what blending onto
    // an empty picture gives, and what lets light be added over the page behind without darkening it.
    const g = canvas.getContext("webgl2", { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!g) return undefined;

    const program = (vertex: string, fragment: string): Program => {
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

    // What lives on the graphics card, and is lost with it: made here, and made again when the
    // browser gives back a context it took away (as a phone may, from a page in the background).
    const SHADOW = 2048;
    let main: Program, depth: Program, screen: Program;
    let shadow: WebGLTexture, frame: WebGLFramebuffer, hides: WebGLRenderbuffer, marks: WebGLTexture;
    let soft: { picture: WebGLTexture; onto: WebGLFramebuffer }[];
    const setup = (): boolean => {
        try {
            main = program(VERTEX, FRAGMENT);
            depth = program(DEPTH_VERTEX, DEPTH_FRAGMENT);
            screen = program(SCREEN_VERTEX, SCREEN_FRAGMENT);
        } catch (problem) {
            console.error("Mote could not set up 3D drawing:", problem);
            return false;
        }

        // where shadows are worked out: how far each thing is from the sun, seen from the sun
        shadow = g.createTexture();
        g.bindTexture(g.TEXTURE_2D, shadow);
        g.texImage2D(g.TEXTURE_2D, 0, g.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, g.DEPTH_COMPONENT, g.UNSIGNED_INT, null);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_COMPARE_MODE, g.COMPARE_REF_TO_TEXTURE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_COMPARE_FUNC, g.LEQUAL);
        frame = g.createFramebuffer();
        g.bindFramebuffer(g.FRAMEBUFFER, frame);
        g.framebufferTexture2D(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.TEXTURE_2D, shadow, 0);
        g.bindFramebuffer(g.FRAMEBUFFER, null);

        // what shines, drawn small and blurred: two pictures a quarter of the canvas each way, blurred from one into the other
        soft = [0, 1].map(() => {
            const picture = g.createTexture();
            g.bindTexture(g.TEXTURE_2D, picture);
            for (const [name, value] of [[g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]] as const) g.texParameteri(g.TEXTURE_2D, name, value);
            const onto = g.createFramebuffer();
            g.bindFramebuffer(g.FRAMEBUFFER, onto);
            g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, picture, 0);
            return { picture, onto };
        });
        hides = g.createRenderbuffer();
        // (bound and given a size before it is attached: a browser warns of one that never was)
        g.bindRenderbuffer(g.RENDERBUFFER, hides);
        g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT24, 1, 1);
        g.bindFramebuffer(g.FRAMEBUFFER, soft[0]!.onto);
        g.framebufferRenderbuffer(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.RENDERBUFFER, hides);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
        marks = g.createTexture();
        [smallWide, smallHigh] = [0, 0];
        stale = true;
        return true;
    };
    let [smallWide, smallHigh] = [0, 0];
    let stale = true;

    // What is written on faces: every different word once, side by side in one picture. A cell no
    // shape uses any more is written over by the next new word, the one longest unused first.
    const CELL = 128;
    const ACROSS = 12;
    const sheet = document.createElement("canvas");
    sheet.width = CELL * ACROSS;
    sheet.height = CELL * ACROSS;
    const pen = sheet.getContext("2d")!;
    const written = new Map<string, number>();
    /** Each cell's word, how many shapes use it, and when the last of them was freed. */
    const cells = Array.from({ length: ACROSS * ACROSS }, () => ({ key: undefined as string | undefined, word: "", onSign: false, users: 0, freed: 0 }));
    let clock = 0;

    const parts: Drawn[] = [];
    let [eyeFrom, eyeTo, eyeDegrees]: [V3, V3, number] = [[0, 5, 20], [0, 0, 0], 30];
    let sunMatrix: M4 = new Float32Array(16);
    let toSun: V3 = [0, 1, 0];
    let levels: [number, number, number] = [1.6, 0.75, 0.3];
    const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    if (!setup()) return undefined;

    const filled = (data: Float32Array, sizes: number[]): [WebGLVertexArrayObject, WebGLBuffer] => {
        const array = g.createVertexArray();
        const buffer = g.createBuffer();
        g.bindVertexArray(array);
        g.bindBuffer(g.ARRAY_BUFFER, buffer);
        g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
        const stride = sizes.reduce((sum, size) => sum + size, 0) * 4;
        let offset = 0;
        sizes.forEach((size, index) => {
            g.enableVertexAttribArray(index);
            g.vertexAttribPointer(index, size, g.FLOAT, false, stride, offset);
            offset += size * 4;
        });
        g.bindVertexArray(null);
        return [array, buffer];
    };

    /** Writes a word in a cell of the sheet. A word on a sign is fitted to the cell's width. */
    const write = (at: number) => {
        const { word, onSign } = cells[at]!;
        const [x, y] = [(at % ACROSS) * CELL, Math.floor(at / ACROSS) * CELL];
        pen.clearRect(x, y, CELL, CELL);
        // on a sign every word is the same height, so that a row of numbers reads as one line
        pen.font = `700 ${onSign ? 80 : word.length > 1 ? 74 : 88}px ${view.font}`;
        pen.textAlign = "center";
        pen.textBaseline = "middle";
        pen.fillStyle = "#fff";
        const wide = pen.measureText(word).width;
        pen.save();
        pen.translate(x + CELL / 2, y + CELL / 2 + 6);
        if (onSign && wide > CELL - 12) pen.scale((CELL - 12) / wide, (CELL - 12) / wide);
        pen.fillText(word, 0, 0);
        pen.restore();
        // a line under 6 and 9 on a face, so that they can be told apart whichever way up
        if (!onSign && (word === "6" || word === "9")) pen.fillRect(x + 40, y + 108, 48, 7);
        stale = true;
    };
    /** The cell of the sheet a word is written in, writing it there the first time. */
    const cell = (word: string, onSign: boolean): [u: number, v: number, at: number] => {
        const key = onSign ? `sign ${word}` : word;
        let at = written.get(key);
        if (at === undefined) {
            // a cell never written in, or else the one whose word has gone unused longest
            let free = -1;
            for (let index = 0; index < cells.length; index++) {
                const [one, best] = [cells[index]!, cells[free]];
                if (one.users > 0) continue;
                if (!best || (best.key !== undefined && (one.key === undefined || one.freed < best.freed))) free = index;
            }
            if (free < 0) console.error("Mote: more different words are shown at once than the sheet has room for, so one is shown in another's place.");
            at = Math.max(0, free);
            if (cells[at]!.key !== undefined) written.delete(cells[at]!.key!);
            Object.assign(cells[at]!, { key, word, onSign });
            written.set(key, at);
            write(at);
        }
        cells[at]!.users++;
        return [(at % ACROSS) / ACROSS, Math.floor(at / ACROSS) / ACROSS, at];
    };
    /** Every shape on the graphics card, by the mesh (or a sign's words) it was made from and then by the words on it. */
    const shapes = new Map<Mesh | string, Map<string, Shape>>();
    /** Puts a shape's faces and words on the graphics card. */
    const upload = (shape: Shape) => {
        if (shape.count) [shape.facesArray, shape.facesBuffer] = filled(shape.faces, [3, 3, 2]);
        if (shape.markCount) [shape.marksArray, shape.marksBuffer] = filled(shape.words, [3, 3, 2, 1]);
    };
    /** The shape for a mesh and the words on it, made only the first time. */
    const shaped = (from: Mesh | string, key: string, make: () => [faces: number[], words: number[], cells: number[]]): Shape => {
        let home = shapes.get(from);
        if (!home) shapes.set(from, (home = new Map()));
        let shape = home.get(key);
        if (!shape) {
            const [faces, words, used] = make();
            shape = { faces: new Float32Array(faces), words: new Float32Array(words), count: faces.length / 8, markCount: words.length / 9, cells: used, users: 0, home, key };
            upload(shape);
            home.set(key, shape);
        }
        return shape;
    };
    /**
     * Frees what no part uses. Done before a picture is drawn, not when a part is removed, so that a
     * scene that takes its parts away and puts the same ones back finds them still there.
     */
    const sweep = () => {
        for (const [from, home] of shapes) {
            for (const shape of home.values()) {
                if (shape.users > 0) continue;
                if (shape.facesArray) g.deleteVertexArray(shape.facesArray);
                if (shape.facesBuffer) g.deleteBuffer(shape.facesBuffer);
                if (shape.marksArray) g.deleteVertexArray(shape.marksArray);
                if (shape.marksBuffer) g.deleteBuffer(shape.marksBuffer);
                for (const at of shape.cells) if (--cells[at]!.users === 0) cells[at]!.freed = ++clock;
                home.delete(shape.key);
            }
            if (home.size === 0) shapes.delete(from);
        }
    };
    const made = (look: Look, shape: Shape): Drawn => {
        shape.users++;
        const part: Drawn = { at: [0, 0, 0], turn: upright(), hidden: false, lit: -1, shine: 0, scale: 1, emit: 0, look, shape };
        parts.push(part);
        return part;
    };
    /** The eye's own right, up and back, from where it is and what it looks at. */
    const eye = (): [V3, V3, V3] => {
        const back = unit(minus(eyeFrom, eyeTo));
        const right = unit(cross(Math.abs(back[1]) > 0.999 ? [0, 0, -1] : [0, 1, 0], back));
        return [right, cross(back, right), back];
    };

    /** A mesh's faces as triangles, and the words on them, as the graphics card takes them. */
    const geometry = (mesh: Mesh, look: Look): [faces: number[], words: number[], cells: number[]] => {
        const faces: number[] = [];
        const words: number[] = [];
        const used: number[] = [];
        const flat = mesh.faces.map((face) => unit(cross(minus(mesh.points[face[1]!]!, mesh.points[face[0]!]!), minus(mesh.points[face[2]!]!, mesh.points[face[0]!]!))));
        // a smooth mesh is lit as if round: each corner faces the way the faces around it do, taken together
        const round = mesh.smooth ? mesh.points.map((_, point) => unit(mesh.faces.reduce<V3>((sum, face, number) => (face.includes(point) ? plus(sum, flat[number]!) : sum), [0, 0, 0]))) : undefined;
        mesh.faces.forEach((face, number) => {
            const corners = face.map((corner) => mesh.points[corner]!);
            const n = flat[number]!;
            // each face as a fan of triangles, all facing the way the face does
            for (let i = 1; i + 1 < corners.length; i++) for (const at of [0, i, i + 1]) faces.push(...corners[at]!, ...(round?.[face[at]!] ?? n), 0, 0);
            const asked = look.marks?.(number);
            if (!asked) return;
            const { middle, room } = seat(mesh, number);
            for (const mark of typeof asked === "string" ? [{ word: asked, group: number } as Mark] : asked) {
                const [u, v, at] = cell(mark.word, false);
                used.push(at);
                // upright toward a corner of the face (its first, unless one is named), and a hair above the face;
                // one that sits toward a corner is smaller, and part of the way out to it
                const toward = minus(corners[mark.corner ?? 0]!, middle);
                const up = unit(toward);
                const right = cross(up, n);
                const [size, out] = mark.corner === undefined ? [room, 0] : [room * 0.5, 0.42];
                const corner = (x: number, y: number) => [
                    ...([0, 1, 2].map((axis) => middle[axis]! + toward[axis]! * out + right[axis]! * x * size + up[axis]! * y * size + n[axis]! * 0.002)),
                    ...n, u + ((x + 1) / 2) / ACROSS, v + ((1 - y) / 2) / ACROSS, mark.group,
                ];
                words.push(...corner(-1, -1), ...corner(1, -1), ...corner(1, 1), ...corner(-1, -1), ...corner(1, 1), ...corner(-1, 1));
            }
        });
        return [faces, words, used];
    };

    const view: View = {
        font: "serif",
        shade: 0,
        color(css) {
            // The page gives colors in forms the graphics card cannot read, so a canvas reads them first.
            probe.clearRect(0, 0, 1, 1);
            probe.fillStyle = css;
            probe.fillRect(0, 0, 1, 1);
            const [r, gg, b] = probe.getImageData(0, 0, 1, 1).data;
            return [r! / 255, gg! / 255, b! / 255];
        },
        add(mesh, look) {
            // the words asked for on each face are part of what the shape is
            const key = look.marks ? JSON.stringify(mesh.faces.map((_, number) => look.marks!(number) ?? 0)) : "";
            return made(look, shaped(mesh, key, () => geometry(mesh, look)));
        },
        sign(words, color) {
            const shape = shaped(`sign ${words}`, "", () => {
                const [u, v, at] = cell(words, true);
                const corner = (x: number, y: number) => [x / 2, y / 2, 0, 0, 0, 1, u + ((x + 1) / 2) / ACROSS, v + ((1 - y) / 2) / ACROSS, 0];
                return [[], [...corner(-1, -1), ...corner(1, -1), ...corner(1, 1), ...corner(-1, -1), ...corner(1, 1), ...corner(-1, 1)], [at]];
            });
            return made({ color, ink: color, over: true, shaded: false }, shape);
        },
        remove(part) {
            const at = parts.indexOf(part as Drawn);
            if (at < 0) return;
            parts.splice(at, 1);
            (part as Drawn).shape.users--;
        },
        look(from, to, degrees) {
            [eyeFrom, eyeTo, eyeDegrees] = [from, to, degrees];
        },
        facing() {
            const [right, up, back] = eye();
            return [[right[0], up[0], back[0]], [right[1], up[1], back[1]], [right[2], up[2], back[2]]];
        },
        ahead(x, y, far) {
            const [right, up, back] = eye();
            const reach = far * Math.tan((eyeDegrees * Math.PI) / 360);
            return plus(plus(minus(eyeFrom, scaled(back, far)), scaled(right, x * reach * (canvas.width / canvas.height))), scaled(up, y * reach));
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
            const [wide, high] = [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
            // only a change is set: setting a canvas's size, even to the one it has, makes its picture again
            if (canvas.width !== wide) canvas.width = wide;
            if (canvas.height !== high) canvas.height = high;
        },
        draw() {
            if (lost || g.isContextLost()) return;
            sweep();
            if (stale) {
                g.bindTexture(g.TEXTURE_2D, marks);
                g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, sheet);
                g.generateMipmap(g.TEXTURE_2D);
                g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
                stale = false;
            }
            const shown = parts.filter((part) => !part.hidden);
            const models = new Map(shown.map((part) => [part, placed(part.at, part.turn, part.scale)]));
            const solid = shown.filter((part) => !part.look.over && (part.look.alpha ?? 1) >= 1);
            const clear = shown.filter((part) => !part.look.over && (part.look.alpha ?? 1) < 1);
            const above = shown.filter((part) => part.look.over);
            const shining = shown.some((part) => part.emit > 0 || (part.lit >= 0 && part.shine > 0));
            g.enable(g.DEPTH_TEST);

            // first, from the sun: how far away the nearest thing is, everywhere it looks
            g.bindFramebuffer(g.FRAMEBUFFER, frame);
            g.viewport(0, 0, SHADOW, SHADOW);
            g.clear(g.DEPTH_BUFFER_BIT);
            g.useProgram(depth.made);
            g.uniformMatrix4fv(depth.at("sun"), false, sunMatrix);
            g.disable(g.BLEND);
            g.depthMask(true);
            for (const part of solid) {
                if (part.look.casts === false || part.look.bare || part.shape.count === 0) continue;
                g.uniformMatrix4fv(depth.at("model"), false, models.get(part)!);
                g.bindVertexArray(part.shape.facesArray!);
                g.drawArrays(g.TRIANGLES, 0, part.shape.count);
            }

            g.useProgram(main.made);
            g.uniformMatrix4fv(main.at("eye"), false, times(perspective(eyeDegrees, canvas.width / canvas.height, 0.5, 120), facingMatrix(eyeFrom, eyeTo)));
            g.uniformMatrix4fv(main.at("sun"), false, sunMatrix);
            g.uniform3fv(main.at("toSun"), toSun);
            g.uniform3fv(main.at("eyeAt"), eyeFrom);
            g.uniform3fv(main.at("levels"), levels);
            g.activeTexture(g.TEXTURE0);
            g.bindTexture(g.TEXTURE_2D, shadow);
            g.uniform1i(main.at("shadow"), 0);
            g.activeTexture(g.TEXTURE1);
            g.bindTexture(g.TEXTURE_2D, marks);
            g.uniform1i(main.at("marks"), 1);

            const paint = (part: Drawn, marked: boolean) => {
                const { shape } = part;
                if ((marked ? shape.markCount : shape.count) === 0 || (!marked && part.look.bare)) return;
                g.uniformMatrix4fv(main.at("model"), false, models.get(part)!);
                g.uniform4f(main.at("color"), ...(marked ? (part.look.ink ?? [0.1, 0.06, 0.14]) : part.look.color), marked ? 1 : (part.look.alpha ?? 1));
                g.uniform1i(main.at("marked"), marked ? 1 : 0);
                g.uniform1f(main.at("glow"), part.lit);
                g.uniform1f(main.at("shine"), part.shine);
                g.uniform1f(main.at("emit"), part.emit);
                g.uniform1f(main.at("gloss"), part.look.gloss ?? 0);
                g.uniform1i(main.at("shaded"), part.look.shaded === false ? 0 : 1);
                g.bindVertexArray((marked ? shape.marksArray : shape.facesArray)!);
                g.drawArrays(g.TRIANGLES, 0, marked ? shape.markCount : shape.count);
            };
            /** What is solid, then what is written on it, a hair nearer so that it is not lost in the face. */
            const solids = () => {
                for (const part of solid) paint(part, false);
                g.depthMask(false);
                g.enable(g.POLYGON_OFFSET_FILL);
                g.polygonOffset(-2, -2);
                for (const part of solid) paint(part, true);
                g.disable(g.POLYGON_OFFSET_FILL);
            };
            /** What is drawn over everything: nothing hides it. */
            const over = () => {
                g.disable(g.DEPTH_TEST);
                for (const part of above) {
                    paint(part, false);
                    paint(part, true);
                }
            };
            const whole = (from: WebGLTexture | null, stride: [number, number], gain: number, tint: [number, number, number, number] = [0, 0, 0, 0]) => {
                g.useProgram(screen.made);
                g.activeTexture(g.TEXTURE2);
                g.bindTexture(g.TEXTURE_2D, from);
                g.uniform1i(screen.at("from"), 2);
                g.uniform2f(screen.at("stride"), ...stride);
                g.uniform1f(screen.at("gain"), gain);
                g.uniform4f(screen.at("tint"), ...tint);
                g.bindVertexArray(null);
                g.drawArrays(g.TRIANGLES, 0, 3);
            };

            // then, if anything shines, a small picture of only that, blurred twice each way
            if (shining) {
                const [wide, high] = [Math.max(1, canvas.width >> 2), Math.max(1, canvas.height >> 2)];
                if (wide !== smallWide || high !== smallHigh) {
                    [smallWide, smallHigh] = [wide, high];
                    // on a place of its own, so that the pictures the scene is drawn with stay where they are
                    g.activeTexture(g.TEXTURE2);
                    for (const { picture } of soft) {
                        g.bindTexture(g.TEXTURE_2D, picture);
                        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, wide, high, 0, g.RGBA, g.UNSIGNED_BYTE, null);
                    }
                    g.bindRenderbuffer(g.RENDERBUFFER, hides);
                    g.renderbufferStorage(g.RENDERBUFFER, g.DEPTH_COMPONENT24, wide, high);
                }
                g.bindFramebuffer(g.FRAMEBUFFER, soft[0]!.onto);
                g.viewport(0, 0, wide, high);
                g.clearColor(0, 0, 0, 0);
                g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
                g.uniform1i(main.at("glowing"), 1);
                solids();
                over();
                g.depthMask(true);
                for (const reach of [1, 2.4]) {
                    g.bindFramebuffer(g.FRAMEBUFFER, soft[1]!.onto);
                    whole(soft[0]!.picture, [reach / wide, 0], 1);
                    g.bindFramebuffer(g.FRAMEBUFFER, soft[0]!.onto);
                    whole(soft[1]!.picture, [0, reach / high], 1);
                }
                g.useProgram(main.made);
                g.enable(g.DEPTH_TEST);
            }

            // then from the eye
            g.bindFramebuffer(g.FRAMEBUFFER, null);
            g.viewport(0, 0, canvas.width, canvas.height);
            g.clearColor(0, 0, 0, 0);
            g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
            g.uniform1i(main.at("glowing"), 0);
            g.enable(g.BLEND);
            g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
            solids();
            for (const part of clear) paint(part, false);
            g.disable(g.DEPTH_TEST);
            if (view.shade > 0) {
                whole(null, [0, 0], 0, [0, 0, 0, view.shade]);
                g.useProgram(main.made);
            }
            over();
            // and the light of what shines, added over it all
            if (shining) {
                g.blendFuncSeparate(g.ONE, g.ONE, g.ZERO, g.ONE);
                whole(soft[0]!.picture, [0, 0], 1.1);
            }
            g.depthMask(true);
            g.bindVertexArray(null);
        },
        dispose() {
            canvas.removeEventListener("webglcontextlost", lose);
            canvas.removeEventListener("webglcontextrestored", restore);
            document.fonts?.removeEventListener("loadingdone", fonts);
            for (const part of parts) part.shape.users--;
            parts.length = 0;
            sweep();
            for (const one of [main, depth, screen]) g.deleteProgram(one.made);
            for (const texture of [shadow, marks, ...soft.map((one) => one.picture)]) g.deleteTexture(texture);
            for (const onto of [frame, ...soft.map((one) => one.onto)]) g.deleteFramebuffer(onto);
            g.deleteRenderbuffer(hides);
            lost = true;
            g.getExtension("WEBGL_lose_context")?.loseContext();
        },
    };

    // A lost context is asked back (that is what preventing the default does), and when it comes
    // back everything on the card is made again from what is kept here, and the picture drawn again.
    let lost = false;
    function lose(event: Event): void {
        event.preventDefault();
        lost = true;
    }
    function restore(): void {
        if (!setup()) return;
        for (const home of shapes.values()) for (const shape of home.values()) upload(shape);
        lost = false;
        view.draw();
    }
    // A word written before its font had come was written in another; when a font comes, every word is written again.
    function fonts(): void {
        cells.forEach((one, at) => one.key !== undefined && write(at));
        if (!lost && parts.length) view.draw();
    }
    canvas.addEventListener("webglcontextlost", lose);
    canvas.addEventListener("webglcontextrestored", restore);
    document.fonts?.addEventListener("loadingdone", fonts);
    return view;
}
