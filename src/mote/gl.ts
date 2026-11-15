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
    /**
     * What it is made of, drawn by the shader on its faces (`Pattern`) and lit by the sun as a lamp: with
     * shadows whose edges soften the further they fall, a shadow where it touches what is under it,
     * and highlights that bloom. Such a part is drawn by a program of its own; a part without one is
     * drawn exactly as it always was. `color` is its main color, `alpha` is left to the pattern.
     */
    pattern?: Pattern;
    /** A light round its edges, in a color and how strong (about 1): what is chosen or warned of, leaving what it is made of to be seen. */
    rim?: [color: Color, strength: number];
    /** For a cloth: how strongly the lines of its grid show, from 0 to 1, and the grid's cell, in the scene's units. */
    grid?: number;
    cell?: number;
}

/**
 * What a part with a pattern is made of. Wood: oak, its grain running along the first of the mesh's
 * `grain` places, its rings about a heart off to one side so that they show as long arches on its
 * faces and as rings on a cut end. Glass: clear, catching the room at a glance, with its edges seen
 * where the `grain` places, from -1 to 1 across a box, near their ends. Marble: a glass ball, its kind
 * by the part's `seed` (0 clear with a ribbon of its three `tints` inside, 1 opaque and glossy with a
 * stripe, 2 steel), its own place turning with it. Metal: polished, in its color (steel, brass);
 * brushed: with fine streaks along the grain. Skin: a drum's skin where its places in the pattern are
 * higher than 0.98 (its top, for a drum one unit high each way of its middle), oak round it. Cloth: a table's, dark, with a grid (`Look.grid`, `Look.cell`).
 */
export type Pattern = "wood" | "glass" | "marble" | "metal" | "brushed" | "skin" | "cloth";

/** What a picture took to draw: draw calls in all, triangles, and the calls of each pass. */
export interface Counts {
    calls: number;
    triangles: number;
    shadow: number;
    contact: number;
    glow: number;
    main: number;
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
    /** For a part with a pattern: a number that makes it unlike others of the same look (a piece of wood its own grain, a marble its kind). */
    seed: number;
    /** For a part with a pattern: three colors of its own (a marble's ribbon or stripe). */
    tints: [Color, Color, Color];
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
    /** For parts with a pattern: drawn by that program, nine numbers a corner (place, facing, place in the pattern). */
    rich?: boolean;
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
    /** How near and how far the eye sees, in the scene's units: 0.5 to 120 unless set, which suits dice; a scene in centimetres sets its own. */
    range: [near: number, far: number];
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
    /** The colors of the sun, of the sky's light and of the light from the ground, for parts with a pattern: a warm lamp in a dark room, say. White unless set. */
    lamp: { sun: Color; sky: Color; ground: Color; size: number; pool?: [x: number, z: number, radius: number] };
    /**
     * How parts with a pattern are drawn: "full", with shadows that soften as they fall further from
     * what casts them, a shadow where things touch, glass that bends the light through it and highlights
     * that bloom; or "plain", for a slower graphics card, with a shadow's edge softened a little only,
     * no shadow where things touch, no bloom, and glass that does not bend the light.
     */
    quality: "full" | "plain";
    /** How strongly the highlights of parts with a pattern bloom, from 0 (none). */
    bloom: number;
    /** What the last picture took to draw. */
    counts: Counts;
    /** Whether parts with a pattern can be drawn as such here; where they cannot, they are drawn plain in their color. */
    patterns: boolean;
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

// ---- parts with a pattern: a program of their own, drawn many of a kind at once ----
//
// Each corner has its place, the way it faces and its place in the pattern; each part drawn (one of
// many of the same shape and look, drawn together) has where it is, its seed and its three tints.

const RICH_VERTEX = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec3 grained;
layout(location = 3) in mat4 model;
layout(location = 7) in float seeded;
layout(location = 8) in vec3 tint0;
layout(location = 9) in vec3 tint1;
layout(location = 10) in vec3 tint2;
uniform mat4 eye, sun, top;
uniform vec3 eyeAt, toSun;
uniform float offset;
out vec3 facing, where, grain, local;
out vec4 lit, high;
flat out float seed;
flat out vec3 tintA, tintB, tintC, localEye, localSun;
void main() {
    vec4 world = model * vec4(position, 1.0);
    mat3 turn = mat3(model);
    facing = turn * normal;
    where = world.xyz;
    grain = grained;
    local = position;
    // looked up in the sun's map a little out from the face, by about a texel, so that a face does not
    // shade itself: out on the side the sun is, since a mesh's faces may be wound either way, and only a
    // face that looks toward the sun is lit by it; and in the map from above, out on the upper side
    vec3 out_ = normalize(facing);
    lit = sun * vec4(world.xyz + out_ * (dot(out_, toSun) < 0.0 ? -offset : offset), 1.0);
    high = top * vec4(world.xyz + out_ * (out_.y < 0.0 ? -offset : offset) * 0.5, 1.0);
    seed = seeded;
    tintA = tint0;
    tintB = tint1;
    tintC = tint2;
    // the eye and the sun in the part's own place, for what is seen inside a glass marble as it turns
    float size = dot(turn[0], turn[0]);
    localEye = transpose(turn) * (eyeAt - model[3].xyz) / size;
    localSun = normalize(transpose(turn) * toSun);
    gl_Position = eye * world;
}`;

const RICH_DEPTH_VERTEX = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 3) in mat4 model;
uniform mat4 sun;
void main() { gl_Position = sun * model * vec4(position, 1.0); }`;

const RICH_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
in vec3 facing, where, grain, local;
in vec4 lit, high;
flat in float seed;
flat in vec3 tintA, tintB, tintC, localEye, localSun;
uniform int pattern;
uniform vec4 color, rim;
uniform vec3 toSun, eyeAt, levels, sunColor, skyColor, groundColor;
uniform float grid, cell, bloom, lampSize, shadowWide, shadowDeep, topWide, topDeep;
uniform vec3 pool;
uniform bool glowing, full, touching;
uniform sampler2DShadow shadow;
uniform sampler2D shadowDepth, tops;
out vec4 result;

const float PI = 3.14159265;

// ---- noise: a hash of whole numbers, and smooth noise from it ----
uint mixed(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
    return v.x ^ v.y ^ v.z;
}
float hashed(vec3 c) { return float(mixed(uvec3(ivec3(c))) >> 8u) / 16777215.0; }
float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hashed(i), hashed(i + vec3(1, 0, 0)), f.x), mix(hashed(i + vec3(0, 1, 0)), hashed(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hashed(i + vec3(0, 0, 1)), hashed(i + vec3(1, 0, 1)), f.x), mix(hashed(i + vec3(0, 1, 1)), hashed(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 linear(vec3 c) { return pow(c, vec3(2.2)); }
// a detail that changes faster than a pixel can show is faded to its average rather than left to shimmer
float shown(float change) { return 1.0 - clamp(change * 0.7 - 0.2, 0.0, 1.0); }

// ---- oak: its rings, the pores of its early wood, its rays, and its fibre ----
vec3 oak(vec3 p, float s) {
    float a = fract(s * 7.31 + 0.13), b = fract(s * 3.17 + 0.41), c = fract(s * 5.83 + 0.77);
    // the heart of the log the piece was cut from: off to one side and below, its axis leaning a little to the grain
    vec2 heart = vec2(-10.0 - 9.0 * b, 7.0 + 12.0 * a) + p.x * vec2(0.03 * (b - 0.5), 0.05 * (a - 0.5));
    vec2 q = p.yz - heart;
    float r = length(q) + 0.45 * noise(p * vec3(0.04, 0.25, 0.25) + s * 17.0) + 0.08 * noise(p * vec3(0.2, 1.6, 1.6));
    float rings = r * (2.1 + 0.9 * c);
    float phase = fract(rings);
    float sharp = shown(fwidth(rings) * 2.0);
    // late wood closes each ring, dense and darker; early wood opens it, with large pores
    float late = mix(0.35, smoothstep(0.62, 0.9, phase) * (1.0 - smoothstep(0.95, 1.0, phase)), sharp);
    float early = (1.0 - smoothstep(0.0, 0.3, phase)) * sharp;
    vec3 pp = p * vec3(0.8, 13.0, 13.0);
    float pore = smoothstep(0.66, 0.84, noise(pp + s * 31.0)) * early * shown(length(fwidth(pp.yz)) * 0.8);
    // the rays run out from the heart, pale flecks where a face runs along them
    float angle = atan(q.y, q.x) * 60.0;
    float ray = smoothstep(0.8, 0.93, noise(vec3(p.x * 0.45, angle, r * 1.2))) * shown(fwidth(angle) * 0.6);
    vec3 ff = p * vec3(0.12, 26.0, 26.0);
    float fibre = mix(0.5, noise(ff), shown(length(fwidth(ff.yz))));
    vec3 pale = linear(vec3(0.64, 0.45, 0.27)) * (0.9 + 0.18 * a);
    vec3 dark = linear(vec3(0.45, 0.29, 0.15)) * (0.9 + 0.14 * b);
    vec3 deep = linear(vec3(0.25, 0.14, 0.07));
    vec3 wood = mix(pale, dark, late * 0.7);
    wood = mix(wood, deep, pore * 0.75);
    wood = mix(wood, pale * 1.18, ray * 0.4);
    // a little warmer or paler, piece to piece
    wood *= vec3(1.0 + 0.06 * (c - 0.5), 1.0, 1.0 - 0.08 * (c - 0.5));
    return wood * (0.9 + 0.2 * fibre);
}

// ---- the room as a polished thing sees it: dark, with the lamp a bright warm disc ----
vec3 room(vec3 d) {
    float up = d.y * 0.5 + 0.5;
    vec3 seen = mix(groundColor * levels.z * 0.18, skyColor * levels.y * 0.12, smoothstep(0.35, 0.75, up));
    float toward = dot(d, toSun);
    float disc = smoothstep(cos(lampSize * 1.6), cos(lampSize * 0.8), toward);
    float glow = pow(max(toward, 0.0), 24.0) * 0.18;
    return seen + sunColor * levels.x * (disc * 9.0 + glow);
}

float fresnel(float facingEye, float base) { return base + (1.0 - base) * pow(1.0 - facingEye, 5.0); }

// ---- the sun's shadow: softer the further behind what casts it, found by looking for what does first ----
const vec2 DISC[12] = vec2[](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621), vec2(0.962, -0.195), vec2(0.473, -0.480),
                              vec2(0.519, 0.767), vec2(0.185, -0.893), vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
float sunlit(vec3 p, vec2 tilt, float slope) {
    if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
    float texel = 1.0 / float(textureSize(shadow, 0).x);
    float bias = 0.00015 + 0.0004 * slope;
    // turned by the pixel, so that the few looks do not line up into bands: still while the view is
    float turn = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 2.0 * PI;
    mat2 spin = mat2(cos(turn), sin(turn), -sin(turn), cos(turn));
    // each look compared with the face's own plane where it looks, so that a wide soft edge does not shade the face itself
    if (!full) {
        float sum = 0.0;
        for (int i = 0; i < 4; i++) {
            vec2 off = spin * DISC[i * 3] * texel * 1.6;
            sum += texture(shadow, vec3(p.xy + off, p.z + dot(tilt, off) - bias));
        }
        return sum / 4.0;
    }
    float search = 1.6 / shadowWide;
    float found = 0.0, nearer = 0.0;
    for (int i = 0; i < 8; i++) {
        vec2 off = spin * DISC[i] * search;
        float d = texture(shadowDepth, p.xy + off).r;
        if (d < p.z + dot(tilt, off) - bias * 3.0) { nearer += d; found += 1.0; }
    }
    if (found < 0.5) return 1.0;
    float behind = (p.z - nearer / found) * shadowDeep;
    float wide = clamp(behind * lampSize / shadowWide, texel * 1.2, texel * 14.0);
    float sum = 0.0;
    for (int i = 0; i < 12; i++) {
        vec2 off = spin * DISC[i] * wide;
        sum += texture(shadow, vec3(p.xy + off, p.z + dot(tilt, off) - bias));
    }
    return sum / 12.0;
}

// ---- where things touch: how much of the sky just above is hidden by what lies close over it ----
float open() {
    if (!full || !touching) return 1.0;
    vec3 p = high.xyz / high.w * 0.5 + 0.5;
    if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0) return 1.0;
    float hidden = 0.0;
    for (int i = 0; i < 8; i++) {
        float reach = i < 4 ? 0.7 : 1.8;
        vec2 at = p.xy + DISC[i * 3 / 2] * reach / topWide;
        float over = (p.z - texture(tops, at).r) * topDeep;
        if (over > 0.05) hidden += over * over / (over * over + reach * reach) * exp(-over / 2.5);
    }
    return 1.0 - min(hidden / 8.0 * 1.6, 0.85);
}

void main() {
    vec3 n = normalize(gl_FrontFacing ? facing : -facing);
    vec3 v = normalize(eyeAt - where);
    float lean = max(dot(n, toSun), 0.0);
    // the face's plane in the sun's map: how its depth there changes across the map, for comparing each look
    vec3 inMap = lit.xyz / lit.w * 0.5 + 0.5;
    vec3 across = dFdx(inMap), down = dFdy(inMap);
    float det = across.x * down.y - down.x * across.y;
    vec2 tilt = abs(det) > 1e-12 ? vec2(down.y * across.z - across.y * down.z, across.x * down.z - down.x * across.z) / det : vec2(0.0);
    tilt = clamp(tilt, vec2(-4.0), vec2(4.0));
    float light = lean > 0.0 ? sunlit(inMap, tilt, 1.0 - lean) : 0.0;
    float sky = open();
    // a lamp lights a pool round the place under it, and less further off
    vec2 off = (where.xz - pool.xy) / max(pool.z, 1e-3);
    vec3 lamp = sunColor * levels.x * (pool.z > 0.0 ? mix(0.3, 1.0, exp(-dot(off, off))) : 1.0);
    vec3 around = mix(groundColor * levels.z, skyColor * levels.y, n.y * 0.5 + 0.5) * sky;
    vec3 half_ = normalize(toSun + v);
    float facingEye = max(dot(n, v), 0.0);
    vec3 seen = vec3(0.0);
    vec3 shine = vec3(0.0);
    float alpha = 1.0;

    if (pattern == 0 || pattern == 5) {
        // oak, oiled: the grain, lit; a soft sheen; on a drum, its skin on top
        vec3 albedo = oak(grain, seed);
        float sheen = 0.035;
        float tight = 28.0;
        if (pattern == 5 && grain.y > 0.98) {
            vec3 fibres = grain * vec3(3.0, 1.0, 3.0);
            albedo = linear(vec3(0.80, 0.72, 0.56)) * (0.85 + 0.25 * noise(fibres * 2.0) + 0.1 * noise(fibres * 9.0));
            sheen = 0.02;
            tight = 12.0;
        }
        seen = albedo * (lamp * lean * light * mix(1.0, sky, 0.5) + around);
        shine = lamp * light * fresnel(facingEye, sheen) * pow(max(dot(n, half_), 0.0), tight) * (tight + 2.0) / 8.0 * lean;
        seen += shine;
    } else if (pattern == 3 || pattern == 4) {
        // metal: a colored reflection of the room, and the lamp in it; brushed, with streaks along the grain
        vec3 tone = linear(color.rgb);
        float streak = pattern == 4 ? noise(grain * vec3(0.3, 60.0, 60.0)) : 0.5;
        streak = mix(0.5, streak, shown(length(fwidth(grain.yz * 60.0)) * 0.5));
        // brushed metal spreads the lamp into a broad soft sheen, streaked; polished keeps it a sharp point
        float tight = pattern == 4 ? 22.0 : 260.0;
        vec3 r = reflect(-v, n);
        vec3 mirror = room(r);
        if (pattern == 4) mirror = mix(mirror, room(normalize(r + n * 0.25)), 0.6);
        float rough = pattern == 4 ? 0.5 : 0.2;
        seen = tone * (lamp * lean * light * rough + around * 0.35) + tone * mirror * (0.7 + 0.6 * streak) * mix(1.0, light, 0.6) * mix(0.6, 1.0, sky);
        shine = lamp * light * tone * pow(max(dot(n, half_), 0.0), tight) * tight / 10.0 * (0.75 + 0.5 * streak);
        if (pattern == 4) shine += lamp * light * tone * pow(max(dot(n, half_), 0.0), 160.0) * 4.0;
        seen += shine;
    } else if (pattern == 6) {
        // the cloth: dark, a fine weave, and the grid's lines, a hair wide on the screen
        vec2 xz = where.xz;
        float weave = mix(0.5, noise(vec3(xz * 9.0, 0.0)), shown(length(fwidth(xz * 9.0))));
        vec3 albedo = linear(color.rgb) * (0.92 + 0.16 * weave);
        vec2 from = abs(fract(xz / cell + 0.5) - 0.5) * cell;
        vec2 wide = fwidth(xz);
        float line = 1.0 - min(smoothstep(0.03, 0.03 + wide.x * 1.3, from.x), smoothstep(0.03, 0.03 + wide.y * 1.3, from.y));
        line *= grid * clamp(1.6 - max(wide.x, wide.y) / cell * 9.0, 0.0, 1.0);
        albedo = mix(albedo, albedo * 1.9 + 0.012, line);
        seen = albedo * (lamp * lean * light * mix(1.0, sky, 0.7) + around);
    } else if (pattern == 1) {
        // glass panes and tubes: barely there face on, the room at a glance, and the edges where faces meet
        float f = fresnel(facingEye, 0.04);
        vec3 r = reflect(-v, n);
        vec3 e = abs(grain);
        vec3 w = fwidth(grain) * 1.4 + 0.004;
        vec3 near = smoothstep(1.0 - 2.0 * w, 1.0 - 0.3 * w, e);
        float edge = dot(grain, grain) > 0.0 ? clamp(near.x * near.y + near.y * near.z + near.z * near.x, 0.0, 1.0) : 0.0;
        shine = room(r) * f * mix(0.5, 1.0, light);
        vec3 tint = linear(vec3(0.82, 0.92, 0.9));
        seen = shine + tint * edge * (lamp * 0.05 + around * 0.6);
        alpha = clamp(0.07 + f * 0.85 + edge * 0.45, 0.0, 1.0);
    } else {
        // a marble, by its kind
        int kind = int(seed) % 3;
        vec3 o = normalize(local);
        vec3 d = normalize(local - localEye);
        vec3 r = reflect(-v, n);
        if (kind == 2) {
            // steel: a mirror of the room, the lamp in it a sharp bright point
            vec3 tone = linear(vec3(0.66, 0.67, 0.70));
            seen = tone * (lamp * lean * light * 0.15 + around * 0.15) + tone * room(r) * mix(0.35, 1.0, light) * mix(0.6, 1.0, sky);
            shine = lamp * light * pow(max(dot(n, half_), 0.0), 900.0) * 40.0;
            seen += shine;
        } else if (kind == 1) {
            // opaque glass, glossy: its color, a stripe round it, and a clear coat that holds the lamp
            float band = abs(o.y + 0.18 * sin(atan(o.z, o.x) * 2.0 + seed * 9.0));
            vec3 albedo = linear(mix(tintA, tintB, smoothstep(0.24, 0.21, band)));
            albedo = mix(albedo, linear(tintC), smoothstep(0.08, 0.05, abs(band - 0.32)));
            float f = fresnel(facingEye, 0.05);
            seen = albedo * (lamp * lean * light + around) * (1.0 - f) + room(r) * f * mix(0.4, 1.0, light);
            shine = lamp * light * pow(max(dot(n, half_), 0.0), 700.0) * 30.0;
            seen += shine;
        } else {
            // clear glass with a twisted ribbon of three vanes inside, seen through the glass, bent by it
            float f = fresnel(facingEye, 0.04);
            vec3 inside = full ? refract(d, o, 1.0 / 1.5) : d;
            float out_ = -2.0 * dot(o, inside);
            float nearest = out_;
            vec3 vane = vec3(0.0);
            for (int k = 0; k < 3; k++) {
                float angle = fract(seed) * 2.0 * PI + float(k) * PI / 3.0;
                float t = 0.0;
                vec3 at = o;
                // the vane twists as it goes up the marble: found again at the twist where it is met, once
                for (int go = 0; go < 2; go++) {
                    float twist = angle + at.y * 0.8;
                    vec3 across = vec3(cos(twist), 0.0, sin(twist));
                    float toward = dot(inside, across);
                    if (abs(toward) < 1e-4) { t = -1.0; break; }
                    t = -dot(o, across) / toward;
                    at = o + inside * t;
                }
                if (t <= 0.0 || t >= nearest) continue;
                float twist = angle + at.y * 0.8;
                // each vane a narrow leaf from the middle out, as tall as most of the marble
                float out2 = abs(dot(at, vec3(-sin(twist), 0.0, cos(twist))));
                float tall = 0.7 * sqrt(max(0.0, 1.0 - (out2 / 0.36) * (out2 / 0.36)));
                if (out2 >= 0.36 || out2 < 0.025 || abs(at.y) >= tall) continue;
                nearest = t;
                vec3 tone = k == 0 ? tintA : k == 1 ? tintB : tintC;
                float side = abs(dot(vec3(cos(twist), 0.0, sin(twist)), localSun));
                float rimmed = smoothstep(0.0, 0.25, 1.0 - out2 / 0.36) * smoothstep(0.0, 0.15, 1.0 - abs(at.y) / max(tall, 1e-3));
                vane = linear(tone) * (0.35 + 0.65 * side) * (0.55 + 0.45 * rimmed);
            }
            bool met = nearest < out_;
            // the glass darkens what is behind it toward its edge, where it turns the light away
            float edge = 1.0 - facingEye;
            vec3 room_ = room(r);
            if (met) {
                seen = vane * (lamp * mix(0.35, 1.0, light) * 0.9 + around * 2.0) * (1.0 - f) * (1.0 - 0.4 * edge) + room_ * f;
                alpha = 1.0;
            } else {
                vec3 glassTint = mix(vec3(1.0), linear(tintA), 0.12);
                seen = room_ * f + glassTint * around * 0.05;
                alpha = clamp(0.06 + 0.6 * edge * edge * edge + f, 0.0, 1.0);
            }
            shine = lamp * light * pow(max(dot(n, half_), 0.0), 1200.0) * 60.0;
            seen += shine;
            // the light through the marble gathered on its far side, a soft glow in the ribbon's color
            float through = pow(max(dot(-n, toSun), 0.0), 3.0) * light;
            seen += linear(tintA) * lamp * through * 0.25;
            alpha = max(alpha, clamp(max(shine.r, max(shine.g, shine.b)), 0.0, 1.0));
        }
    }

    // what is chosen or warned of: a light round its edges in that color, and a little over it
    if (rim.a > 0.0) seen += linear(rim.rgb) * rim.a * (0.08 + 1.3 * pow(1.0 - facingEye, 2.5));

    if (glowing) {
        // only what is brighter than white blooms, warm, as a highlight does
        vec3 over = max(shine - 0.7, 0.0) * bloom;
        float strength = max(over.r, max(over.g, over.b));
        if (strength <= 0.0) discard;
        result = vec4(over, min(strength, 1.0));
        return;
    }
    // a gentle shoulder, so that a highlight is white and not a flat clipped color, then to the screen's colors
    seen = seen * (2.51 * seen + 0.03) / (seen * (2.43 * seen + 0.59) + 0.14);
    // blended over what is behind as alpha says: so what see-through glass adds is divided by it here
    vec3 display = pow(clamp(seen, 0.0, 1.0), vec3(1.0 / 2.2));
    result = vec4(min(display / max(alpha, 1e-3), vec3(1.0)), alpha);
}`;

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
        const shaders = ([[g.VERTEX_SHADER, vertex], [g.FRAGMENT_SHADER, fragment]] as const).map(([kind, source]) => {
            const shader = g.createShader(kind)!;
            g.shaderSource(shader, source);
            g.compileShader(shader);
            if (!g.getShaderParameter(shader, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(shader) ?? "A shader did not compile.");
            g.attachShader(made, shader);
            return shader;
        });
        g.linkProgram(made);
        // the program keeps what it needs of its shaders once linked
        for (const shader of shaders) g.deleteShader(shader);
        if (!g.getProgramParameter(made, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(made) ?? "A program did not link.");
        const names = new Map<string, WebGLUniformLocation | null>();
        return { made, at: (name: string) => names.get(name) ?? (names.set(name, g.getUniformLocation(made, name)), names.get(name)!) };
    };

    // What lives on the graphics card, and is lost with it: made here, and made again when the
    // browser gives back a context it took away (as a phone may, from a page in the background).
    const SHADOW = 2048;
    /** The map from above, of how high the highest thing is everywhere, for the shadow where things touch. */
    const TOPS = 1024;
    let main: Program, depth: Program, screen: Program;
    let shadow: WebGLTexture, frame: WebGLFramebuffer, hides: WebGLRenderbuffer, marks: WebGLTexture;
    let soft: { picture: WebGLTexture; onto: WebGLFramebuffer }[];
    // for parts with a pattern: their programs, the shadow map read as depths, the map from above, and
    // one buffer of where each part is, filled for each kind drawn together
    let rich: Program | undefined, richDepth: Program | undefined;
    let raw: WebGLSampler, tops: WebGLTexture, topFrame: WebGLFramebuffer, many: WebGLBuffer;
    let manyRoom = 0;
    const setup = (): boolean => {
        try {
            main = program(VERTEX, FRAGMENT);
            depth = program(DEPTH_VERTEX, DEPTH_FRAGMENT);
            screen = program(SCREEN_VERTEX, SCREEN_FRAGMENT);
        } catch (problem) {
            console.error("Mote could not set up 3D drawing:", problem);
            return false;
        }
        rich = richDepth = undefined;
        tried = false;

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
    let tried = false;
    /**
     * Sets up what parts with a pattern are drawn with, the first time one is added: so that a scene
     * without them sets up nothing more than it ever did. Where the program cannot be made, such parts
     * are drawn plain, in their color.
     */
    const prepare = (): boolean => {
        if (tried) return rich !== undefined;
        tried = true;
        try {
            rich = program(RICH_VERTEX, RICH_FRAGMENT);
            richDepth = program(RICH_DEPTH_VERTEX, DEPTH_FRAGMENT);
        } catch (problem) {
            console.warn("Mote draws patterns plain here:", problem);
            rich = richDepth = undefined;
            view.patterns = false;
            return false;
        }
        raw = g.createSampler();
        for (const [name, value] of [[g.TEXTURE_MIN_FILTER, g.NEAREST], [g.TEXTURE_MAG_FILTER, g.NEAREST], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE], [g.TEXTURE_COMPARE_MODE, g.NONE]] as const) g.samplerParameteri(raw, name, value);
        many = g.createBuffer();
        manyRoom = 0;
        tops = g.createTexture();
        g.bindTexture(g.TEXTURE_2D, tops);
        g.texImage2D(g.TEXTURE_2D, 0, g.DEPTH_COMPONENT24, TOPS, TOPS, 0, g.DEPTH_COMPONENT, g.UNSIGNED_INT, null);
        for (const [name, value] of [[g.TEXTURE_MIN_FILTER, g.NEAREST], [g.TEXTURE_MAG_FILTER, g.NEAREST], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]] as const) g.texParameteri(g.TEXTURE_2D, name, value);
        topFrame = g.createFramebuffer();
        g.bindFramebuffer(g.FRAMEBUFFER, topFrame);
        g.framebufferTexture2D(g.FRAMEBUFFER, g.DEPTH_ATTACHMENT, g.TEXTURE_2D, tops, 0);
        g.bindFramebuffer(g.FRAMEBUFFER, null);
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
    let topMatrix: M4 = new Float32Array(16);
    let sunBox = { wide: 10, deep: 10 };
    let topBox = { wide: 10, deep: 10 };
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
        if (shape.rich) {
            if (shape.count) [shape.facesArray, shape.facesBuffer] = filledMany(shape.faces);
            return;
        }
        if (shape.count) [shape.facesArray, shape.facesBuffer] = filled(shape.faces, [3, 3, 2]);
        if (shape.markCount) [shape.marksArray, shape.marksBuffer] = filled(shape.words, [3, 3, 2, 1]);
    };
    /** Numbers kept for each part drawn together: where it is (sixteen), its seed and its three tints. */
    const EACH = 26;
    /** A shape's corners for the program for patterns, and the shared buffer of where each part of it is. */
    const filledMany = (data: Float32Array): [WebGLVertexArrayObject, WebGLBuffer] => {
        const array = g.createVertexArray();
        const buffer = g.createBuffer();
        g.bindVertexArray(array);
        g.bindBuffer(g.ARRAY_BUFFER, buffer);
        g.bufferData(g.ARRAY_BUFFER, data, g.STATIC_DRAW);
        for (let index = 0; index < 3; index++) {
            g.enableVertexAttribArray(index);
            g.vertexAttribPointer(index, 3, g.FLOAT, false, 36, index * 12);
        }
        g.bindBuffer(g.ARRAY_BUFFER, many);
        // where it is, four columns, then its seed and its tints, once for each part drawn
        const sizes = [4, 4, 4, 4, 1, 3, 3, 3];
        let offset = 0;
        sizes.forEach((size, i) => {
            g.enableVertexAttribArray(3 + i);
            g.vertexAttribPointer(3 + i, size, g.FLOAT, false, EACH * 4, offset);
            g.vertexAttribDivisor(3 + i, 1);
            offset += size * 4;
        });
        g.bindVertexArray(null);
        return [array, buffer];
    };
    /** A mesh's faces as triangles for the program for patterns: each corner's place, the way it faces, and its place in the pattern. */
    const manyGeometry = (mesh: Mesh): number[] => {
        const out: number[] = [];
        const flat = mesh.faces.map((face) => unit(cross(minus(mesh.points[face[1]!]!, mesh.points[face[0]!]!), minus(mesh.points[face[2]!]!, mesh.points[face[0]!]!))));
        let round: V3[] | undefined;
        if (mesh.smooth) {
            const sums = mesh.points.map((): V3 => [0, 0, 0]);
            mesh.faces.forEach((face, number) => {
                for (const point of new Set(face)) sums[point] = plus(sums[point]!, flat[number]!);
            });
            round = sums.map(unit);
        }
        mesh.faces.forEach((face, number) => {
            for (let i = 1; i + 1 < face.length; i++) {
                for (const at of [0, i, i + 1]) {
                    const corner = face[at]!;
                    out.push(...mesh.points[corner]!, ...(round?.[corner] ?? flat[number]!), ...(mesh.grain?.[corner] ?? mesh.points[corner]!));
                }
            }
        });
        return out;
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
        const part: Drawn = { at: [0, 0, 0], turn: upright(), hidden: false, lit: -1, shine: 0, scale: 1, emit: 0, seed: 0, tints: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], look, shape };
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
        // Summed in one pass over the faces, each face's normal added once to each of its corners, in the
        // faces' order, so that a long piece of track of thousands of faces is ready at once.
        let round: V3[] | undefined;
        if (mesh.smooth) {
            const sums = mesh.points.map((): V3 => [0, 0, 0]);
            mesh.faces.forEach((face, number) => {
                for (const point of new Set(face)) sums[point] = plus(sums[point]!, flat[number]!);
            });
            round = sums.map(unit);
        }
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

    /** A batch of parts with a pattern drawn together: one shape, one look, and the parts, in the order to draw them. */
    type Batch = { shape: Shape; look: Look; parts: Drawn[] };
    /**
     * Parts with a pattern, gathered by shape and look so that each kind is drawn at once: the solid
     * ones, and the see-through ones (glass, marbles), each kind sorted furthest first, and the marbles
     * before the glass, so that each is seen through what is in front of it.
     */
    const together = (patterned: Drawn[]): { solid: Batch[]; see: Batch[] } => {
        const kinds = new Map<Shape, Map<Look, Drawn[]>>();
        for (const part of patterned) {
            let byLook = kinds.get(part.shape);
            if (!byLook) kinds.set(part.shape, (byLook = new Map()));
            const list = byLook.get(part.look);
            if (list) list.push(part);
            else byLook.set(part.look, [part]);
        }
        const solid: Batch[] = [];
        const see: Batch[] = [];
        const far = (part: Drawn) => (part.at[0] - eyeFrom[0]) ** 2 + (part.at[1] - eyeFrom[1]) ** 2 + (part.at[2] - eyeFrom[2]) ** 2;
        for (const [shape, byLook] of kinds) {
            for (const [look, list] of byLook) {
                const clearOnes = look.pattern === "glass" || look.pattern === "marble";
                if (clearOnes) list.sort((a, b) => far(b) - far(a));
                (clearOnes ? see : solid).push({ shape, look, parts: list });
            }
        }
        see.sort((a, b) => Number(a.look.pattern === "glass") - Number(b.look.pattern === "glass") || far(b.parts[0]!) - far(a.parts[0]!));
        return { solid, see };
    };
    let manyData = new Float32Array(0);
    /** Fills the shared buffer with where each part of a batch is, its seed and its tints. */
    const fillMany = (batch: Batch) => {
        const need = batch.parts.length * EACH;
        if (manyData.length < need) manyData = new Float32Array(Math.max(need, manyData.length * 2, EACH * 64));
        batch.parts.forEach((part, i) => {
            manyData.set(placed(part.at, part.turn, part.scale), i * EACH);
            manyData[i * EACH + 16] = part.seed;
            for (let k = 0; k < 3; k++) manyData.set(part.tints[k]!, i * EACH + 17 + k * 3);
        });
        g.bindBuffer(g.ARRAY_BUFFER, many);
        if (manyRoom < need) {
            g.bufferData(g.ARRAY_BUFFER, manyData.byteLength, g.DYNAMIC_DRAW);
            manyRoom = manyData.length;
        }
        g.bufferSubData(g.ARRAY_BUFFER, 0, manyData, 0, need);
    };
    /** Parts with a pattern, as seen from the sun or from above: where they hide what is behind them. */
    const castMany = (batches: { solid: Batch[]; see: Batch[] }, matrix: M4, counts: Counts, into: "shadow" | "contact") => {
        if (!richDepth) return;
        g.useProgram(richDepth.made);
        g.uniformMatrix4fv(richDepth.at("sun"), false, matrix);
        for (const batch of [...batches.solid, ...batches.see]) {
            if (batch.look.casts === false || batch.shape.count === 0) continue;
            fillMany(batch);
            g.bindVertexArray(batch.shape.facesArray!);
            g.drawArraysInstanced(g.TRIANGLES, 0, batch.shape.count, batch.parts.length);
            counts[into]++;
            counts.triangles += (batch.shape.count / 3) * batch.parts.length;
        }
    };
    const PATTERNS: Record<Pattern, number> = { wood: 0, glass: 1, marble: 2, metal: 3, brushed: 4, skin: 5, cloth: 6 };
    /** Parts with a pattern, from the eye: the solid ones, then the marbles, then the glass; or for the glow, only their highlights. */
    const paintMany = (batches: { solid: Batch[]; see: Batch[] }, glow: boolean, counts: Counts) => {
        if (!rich) return;
        const r = rich;
        g.useProgram(r.made);
        g.uniformMatrix4fv(r.at("eye"), false, times(perspective(eyeDegrees, canvas.width / canvas.height, view.range[0], view.range[1]), facingMatrix(eyeFrom, eyeTo)));
        g.uniformMatrix4fv(r.at("sun"), false, sunMatrix);
        g.uniformMatrix4fv(r.at("top"), false, topMatrix);
        g.uniform3fv(r.at("toSun"), toSun);
        g.uniform3fv(r.at("eyeAt"), eyeFrom);
        g.uniform3fv(r.at("levels"), levels);
        g.uniform3fv(r.at("sunColor"), view.lamp.sun);
        g.uniform3fv(r.at("skyColor"), view.lamp.sky);
        g.uniform3fv(r.at("groundColor"), view.lamp.ground);
        g.uniform1f(r.at("lampSize"), view.lamp.size);
        g.uniform3fv(r.at("pool"), view.lamp.pool ?? [0, 0, 0]);
        g.uniform1f(r.at("shadowWide"), sunBox.wide);
        g.uniform1f(r.at("shadowDeep"), sunBox.deep);
        g.uniform1f(r.at("topWide"), topBox.wide);
        g.uniform1f(r.at("topDeep"), topBox.deep);
        g.uniform1f(r.at("offset"), (sunBox.wide / SHADOW) * 1.5);
        g.uniform1f(r.at("bloom"), view.bloom);
        g.uniform1i(r.at("glowing"), glow ? 1 : 0);
        g.uniform1i(r.at("full"), view.quality === "full" ? 1 : 0);
        g.uniform1i(r.at("touching"), 1);
        g.activeTexture(g.TEXTURE0);
        g.bindTexture(g.TEXTURE_2D, shadow);
        g.uniform1i(r.at("shadow"), 0);
        // the same map again, read as depths, to find what casts a shadow and how far off
        g.activeTexture(g.TEXTURE3);
        g.bindTexture(g.TEXTURE_2D, shadow);
        g.bindSampler(3, raw);
        g.uniform1i(r.at("shadowDepth"), 3);
        g.activeTexture(g.TEXTURE4);
        g.bindTexture(g.TEXTURE_2D, tops);
        g.bindSampler(4, raw);
        g.uniform1i(r.at("tops"), 4);
        const each = (batch: Batch) => {
            const look = batch.look;
            if (batch.shape.count === 0) return;
            g.uniform1i(r.at("pattern"), PATTERNS[look.pattern!]);
            g.uniform4f(r.at("color"), ...look.color, look.alpha ?? 1);
            g.uniform4f(r.at("rim"), ...(look.rim ? look.rim[0] : ([0, 0, 0] as Color)), look.rim ? look.rim[1] : 0);
            g.uniform1f(r.at("grid"), look.grid ?? 0);
            g.uniform1f(r.at("cell"), look.cell ?? 1);
            fillMany(batch);
            g.bindVertexArray(batch.shape.facesArray!);
            g.drawArraysInstanced(g.TRIANGLES, 0, batch.shape.count, batch.parts.length);
            counts[glow ? "glow" : "main"]++;
            counts.triangles += (batch.shape.count / 3) * batch.parts.length;
        };
        g.depthMask(true);
        for (const batch of batches.solid) each(batch);
        // marbles hide one another, so they keep their depth; glass, behind which all of it is seen, does not
        for (const batch of batches.see) {
            g.depthMask(batch.look.pattern !== "glass");
            each(batch);
        }
        g.depthMask(true);
        g.bindSampler(3, null);
        g.bindSampler(4, null);
        g.activeTexture(g.TEXTURE0);
        g.useProgram(main.made);
    };

    const view: View = {
        font: "serif",
        shade: 0,
        range: [0.5, 120],
        lamp: { sun: [1, 1, 1], sky: [1, 1, 1], ground: [1, 1, 1], size: 0.04 },
        quality: "full",
        bloom: 0,
        counts: { calls: 0, triangles: 0, shadow: 0, contact: 0, glow: 0, main: 0 },
        patterns: true,
        color(css) {
            // The page gives colors in forms the graphics card cannot read, so a canvas reads them first.
            probe.clearRect(0, 0, 1, 1);
            probe.fillStyle = css;
            probe.fillRect(0, 0, 1, 1);
            const [r, gg, b] = probe.getImageData(0, 0, 1, 1).data;
            return [r! / 255, gg! / 255, b! / 255];
        },
        add(mesh, look) {
            if (look.pattern && prepare()) {
                let home = shapes.get(mesh);
                if (!home) shapes.set(mesh, (home = new Map()));
                let shape = home.get("rich");
                if (!shape) {
                    const faces = new Float32Array(manyGeometry(mesh));
                    shape = { faces, words: new Float32Array(0), count: faces.length / 9, markCount: 0, cells: [], users: 0, home, key: "rich", rich: true };
                    upload(shape);
                    home.set("rich", shape);
                }
                return made(look, shape);
            }
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
            sunBox = { wide: Math.max(most[0]! - least[0]!, most[1]! - least[1]!), deep: most[2]! - least[2]! + 2 };
            // and from straight above, over the same box, for how high the highest thing is everywhere
            const over: V3 = [middle[0], high[1] + 5, middle[2]];
            const [halfX, halfZ] = [(high[0] - low[0]) / 2 + 2, (high[2] - low[2]) / 2 + 2];
            const deep = high[1] - low[1] + 10;
            topMatrix = times(box(-halfX, halfX, -halfZ, halfZ, 0, deep), facingMatrix(over, [middle[0], low[1] - 5, middle[2]]));
            topBox = { wide: Math.max(halfX, halfZ) * 2, deep };
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
            const counts: Counts = { calls: 0, triangles: 0, shadow: 0, contact: 0, glow: 0, main: 0 };
            const shown = parts.filter((part) => !part.hidden);
            // parts with a pattern, drawn by their own program; none, and the picture is drawn as it always was
            const patterned = shown.filter((part) => part.shape.rich);
            const plain = patterned.length ? shown.filter((part) => !part.shape.rich) : shown;
            const models = new Map(plain.map((part) => [part, placed(part.at, part.turn, part.scale)]));
            const solid = plain.filter((part) => !part.look.over && (part.look.alpha ?? 1) >= 1);
            const clear = plain.filter((part) => !part.look.over && (part.look.alpha ?? 1) < 1);
            const above = plain.filter((part) => part.look.over);
            const shining = plain.some((part) => part.emit > 0 || (part.lit >= 0 && part.shine > 0));
            const full = view.quality === "full";
            const blooming = patterned.length > 0 && full && view.bloom > 0;
            const batches = patterned.length ? together(patterned) : { solid: [], see: [] };
            g.enable(g.DEPTH_TEST);

            // first, from the sun: how far away the nearest thing is, everywhere it looks
            g.bindFramebuffer(g.FRAMEBUFFER, frame);
            g.viewport(0, 0, SHADOW, SHADOW);
            g.clear(g.DEPTH_BUFFER_BIT);
            g.useProgram(depth.made);
            g.uniformMatrix4fv(depth.at("sun"), false, sunMatrix);
            g.disable(g.BLEND);
            g.depthMask(true);
            const casts = (into: "shadow" | "contact") => {
                for (const part of solid) {
                    if (part.look.casts === false || part.shape.count === 0) continue;
                    g.uniformMatrix4fv(depth.at("model"), false, models.get(part)!);
                    g.bindVertexArray(part.shape.facesArray!);
                    g.drawArrays(g.TRIANGLES, 0, part.shape.count);
                    counts[into]++;
                    counts.triangles += part.shape.count / 3;
                }
            };
            casts("shadow");
            if (patterned.length) {
                castMany(batches, sunMatrix, counts, "shadow");
                // and from above, how high the highest thing is everywhere, for the shadow where things touch
                if (full) {
                    g.bindFramebuffer(g.FRAMEBUFFER, topFrame);
                    g.viewport(0, 0, TOPS, TOPS);
                    g.clear(g.DEPTH_BUFFER_BIT);
                    g.useProgram(depth.made);
                    g.uniformMatrix4fv(depth.at("sun"), false, topMatrix);
                    casts("contact");
                    castMany(batches, topMatrix, counts, "contact");
                }
                g.useProgram(main.made);
            }

            g.useProgram(main.made);
            g.uniformMatrix4fv(main.at("eye"), false, times(perspective(eyeDegrees, canvas.width / canvas.height, view.range[0], view.range[1]), facingMatrix(eyeFrom, eyeTo)));
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

            let pass: "glow" | "main" = "main";
            const paint = (part: Drawn, marked: boolean) => {
                const { shape } = part;
                if ((marked ? shape.markCount : shape.count) === 0) return;
                counts[pass]++;
                counts.triangles += (marked ? shape.markCount : shape.count) / 3;
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
            if (shining || blooming) {
                pass = "glow";
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
                if (patterned.length) paintMany(batches, true, counts);
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
            pass = "main";
            g.bindFramebuffer(g.FRAMEBUFFER, null);
            g.viewport(0, 0, canvas.width, canvas.height);
            g.clearColor(0, 0, 0, 0);
            g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
            g.uniform1i(main.at("glowing"), 0);
            g.enable(g.BLEND);
            g.blendFuncSeparate(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA, g.ONE, g.ONE_MINUS_SRC_ALPHA);
            if (patterned.length) paintMany(batches, false, counts);
            solids();
            for (const part of clear) paint(part, false);
            g.disable(g.DEPTH_TEST);
            if (view.shade > 0) {
                whole(null, [0, 0], 0, [0, 0, 0, view.shade]);
                g.useProgram(main.made);
            }
            over();
            // and the light of what shines, added over it all
            if (shining || blooming) {
                g.blendFuncSeparate(g.ONE, g.ONE, g.ZERO, g.ONE);
                whole(soft[0]!.picture, [0, 0], 1.1);
            }
            g.depthMask(true);
            g.bindVertexArray(null);
            counts.calls = counts.shadow + counts.contact + counts.glow + counts.main;
            view.counts = counts;
        },
        dispose() {
            canvas.removeEventListener("webglcontextlost", lose);
            canvas.removeEventListener("webglcontextrestored", restore);
            document.fonts?.removeEventListener("loadingdone", fonts);
            for (const part of parts) part.shape.users--;
            parts.length = 0;
            sweep();
            for (const one of [main, depth, screen, rich, richDepth]) if (one) g.deleteProgram(one.made);
            for (const texture of [shadow, marks, ...soft.map((one) => one.picture)]) g.deleteTexture(texture);
            for (const onto of [frame, ...soft.map((one) => one.onto)]) g.deleteFramebuffer(onto);
            if (rich) {
                g.deleteTexture(tops);
                g.deleteFramebuffer(topFrame);
                g.deleteBuffer(many);
                g.deleteSampler(raw);
            }
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
        const wanted = rich !== undefined;
        if (!setup()) return;
        if (wanted) prepare();
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
