// The grade on the card: the same sums as grade.ts, written again in GLSL for WebGL2 and in WGSL
// for WebGPU, and the one list of numbers both read. A list of grades (the whole picture's, then
// each part's, blended by its mask) is packed into a flat run of four-number entries: a header saying
// where each grade starts, then each grade's numbers, its baked curve and its look. WebGL2 reads the
// run as a float texture 1024 entries wide, WebGPU as a storage buffer; the masks are a stack of
// float layers of one size, read between their entries by hand so that both ways and the reference
// read them alike.
//
//   const packed = pack([{ ready: prepare(grade, "srgb") }]);
//   gl: GRADE_GLSL in a fragment shader, then graded(color, place)

import { CURVE, type Prepared } from "./grade";

/** How many entries a row of the packed run has, as WebGL2's texture holds it. */
export const ROW = 1024;
/** Entries of a grade's own numbers, before its curve. */
const OWN = 16;
/** The most grades drawn at once: the whole picture's and fifteen parts. */
export const MOST_GRADES = 16;

/** One grade as it is packed: its numbers, the layer of its mask (none for the whole picture), and whether the mask is turned inside out. */
export interface PackedGrade {
    ready: Prepared;
    layer?: number;
    invert?: boolean;
}

/** The packed run: the numbers, four to an entry, padded to whole rows, and how many grades it holds. */
export interface Packed {
    data: Float32Array;
    count: number;
    rows: number;
}

/** Packs grades into one run of entries for the card, in the order they are applied. */
export function pack(list: PackedGrade[]): Packed {
    const grades = list.slice(0, MOST_GRADES);
    let entries = grades.length;
    const starts = grades.map((each) => {
        const start = entries;
        entries += OWN + (each.ready.curve ? CURVE : 0) + (each.ready.lut ? each.ready.lut.table.length / 4 : 0);
        return start;
    });
    const rows = Math.max(1, Math.ceil(entries / ROW));
    const data = new Float32Array(rows * ROW * 4);
    grades.forEach((each, index) => {
        const at = starts[index]!;
        data[index * 4] = at;
        const { ready } = each;
        const set = (entry: number, values: number[]) => data.set(values, (at + entry) * 4);
        const curveAt = ready.curve ? at + OWN : -1;
        const lutAt = ready.lut ? at + OWN + (ready.curve ? CURVE : 0) : -1;
        set(0, [...ready.gains, ready.exposure]);
        set(1, [ready.contrast, ready.shadows, ready.highs, ready.saturation]);
        set(2, [...ready.wheels.slice(0, 3), curveAt]);
        set(3, [...ready.wheels.slice(3, 6), ready.lut ? (ready.lut.kind === "3d" ? 1 : 2) : 0]);
        set(4, [...ready.wheels.slice(6, 9), ready.lut?.size ?? 0]);
        set(5, [...(ready.lut?.low ?? [0, 0, 0]), lutAt]);
        set(6, [...(ready.lut?.high ?? [1, 1, 1]), ready.colors.length]);
        ready.colors.slice(0, 3).forEach((color, which) => set(7 + which, [color.hue, color.shift, color.saturation, color.lightness]));
        set(10, [each.layer ?? -1, each.invert ? 1 : 0, 0, 0]);
        if (ready.curve) data.set(ready.curve, (at + OWN) * 4);
        if (ready.lut) data.set(ready.lut.table, lutAt * 4);
    });
    return { data, count: grades.length, rows };
}

/** The grade in GLSL for WebGL2: `graded(color, place)` grades an encoded color at a place in the original's pixels. Its uniforms are set by gl.ts. */
export const GRADE_GLSL = `
uniform highp sampler2D gradeData;
uniform highp sampler2DArray gradeMasks;
uniform int gradeCount;
uniform vec3 luma;
uniform vec3 backR;
uniform vec3 backG;
uniform vec3 backB;
uniform vec2 maskSize;
uniform vec2 pictureSize;
const float PIVOT = ${Math.fround(1.055 * Math.pow(0.18, 1 / 2.4) - 0.055).toFixed(9)};
vec4 entry(int i) { return texelFetch(gradeData, ivec2(i % ${ROW}, i / ${ROW}), 0); }
float encode1(float x) { return x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1.0 / 2.4) - 0.055; }
float decode1(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
vec3 encode3(vec3 x) { return vec3(encode1(x.r), encode1(x.g), encode1(x.b)); }
vec3 decode3(vec3 v) { return vec3(decode1(v.r), decode1(v.g), decode1(v.b)); }
float power(float x, float y) { return x <= 0.0 ? 0.0 : pow(x, y); }
float bump(float p) { return p * (1.0 - p) * (1.0 - p) * (1.0 - p) / 0.10546875; }
float contrast1(float p, float a) { return p < PIVOT ? PIVOT * power(clamp(p, 0.0, 1.0) / PIVOT, a) : 1.0 - (1.0 - PIVOT) * power(clamp(1.0 - p, 0.0, 1.0) / (1.0 - PIVOT), a); }
float curve1(int row, float p, int channel) {
    float t = clamp(p, 0.0, 1.0) * ${CURVE - 1}.0;
    float at = min(${CURVE - 2}.0, floor(t));
    return mix(entry(row + int(at))[channel], entry(row + int(at) + 1)[channel], t - at);
}
float near(float hue, float chroma, float picked) {
    float d = mod(abs(hue - picked), 6.283185307179586);
    if (d > 3.141592653589793) d = 6.283185307179586 - d;
    float n = d < 0.5235987755982988 ? 1.0 : d < 1.0471975511965976 ? 0.5 + 0.5 * cos((d - 0.5235987755982988) * 6.0) : 0.0;
    return n * smoothstep(0.02, 0.1, chroma);
}
vec3 look3(int base, vec3 c) {
    vec4 kind = entry(base + 3);
    float n = entry(base + 4).w;
    vec4 lowRow = entry(base + 5);
    vec3 high = entry(base + 6).xyz;
    int row = int(lowRow.w);
    vec3 place = clamp((c - lowRow.xyz) / (high - lowRow.xyz), 0.0, 1.0) * (n - 1.0);
    if (kind.w == 2.0) {
        vec3 o;
        for (int ch = 0; ch < 3; ch++) {
            float at = min(n - 2.0, floor(place[ch]));
            o[ch] = mix(entry(row + int(at))[ch], entry(row + int(at) + 1)[ch], place[ch] - at);
        }
        return o;
    }
    vec3 low = min(vec3(n - 2.0), floor(place));
    vec3 part = place - low;
    int size = int(n);
    vec3 o = vec3(0.0);
    for (int corner = 0; corner < 8; corner++) {
        ivec3 bit = ivec3(corner & 1, (corner >> 1) & 1, (corner >> 2) & 1);
        float w = (bit.x == 1 ? part.x : 1.0 - part.x) * (bit.y == 1 ? part.y : 1.0 - part.y) * (bit.z == 1 ? part.z : 1.0 - part.z);
        ivec3 at = ivec3(low) + bit;
        o += w * entry(row + at.x + size * (at.y + size * at.z)).rgb;
    }
    return o;
}
vec3 finish(int base, vec3 c) {
    if (entry(base + 3).w != 0.0) c = look3(base, clamp(c, 0.0, 1.0));
    return clamp(c, 0.0, 1.0);
}
vec3 gradeOne(vec3 c, int base) {
    vec4 e0 = entry(base);
    vec4 e1 = entry(base + 1);
    vec3 gains = e0.rgb;
    float g = e0.w;
    if (gains != vec3(1.0) || g != 1.0) {
        vec3 lin = decode3(c);
        if (gains != vec3(1.0)) lin = clamp(lin * gains, 0.0, 1.0);
        if (g > 1.0) lin = vec3(1.0) - vec3(power(1.0 - clamp(lin.r, 0.0, 1.0), g), power(1.0 - clamp(lin.g, 0.0, 1.0), g), power(1.0 - clamp(lin.b, 0.0, 1.0), g));
        else if (g < 1.0) lin = lin * g;
        c = encode3(lin);
    }
    if (e1.x != 1.0) c = vec3(contrast1(c.r, e1.x), contrast1(c.g, e1.x), contrast1(c.b, e1.x));
    if (e1.y != 0.0) c = c + e1.y * vec3(bump(clamp(c.r, 0.0, 1.0)), bump(clamp(c.g, 0.0, 1.0)), bump(clamp(c.b, 0.0, 1.0)));
    if (e1.z != 0.0) c = vec3(1.0) - (vec3(1.0) - c + e1.z * vec3(bump(clamp(1.0 - c.r, 0.0, 1.0)), bump(clamp(1.0 - c.g, 0.0, 1.0)), bump(clamp(1.0 - c.b, 0.0, 1.0))));
    vec4 e2 = entry(base + 2);
    vec3 ws = e2.rgb;
    vec3 wm = entry(base + 3).rgb;
    vec3 wh = entry(base + 4).rgb;
    if (ws != vec3(0.0) || wm != vec3(0.0) || wh != vec3(0.0)) {
        float y = clamp(dot(luma, c), 0.0, 1.0);
        float low = (1.0 - y) * (1.0 - y);
        float high = y * y;
        c = c + low * ws + (1.0 - low - high) * wm + high * wh;
    }
    c = clamp(c, 0.0, 1.0);
    if (e2.w >= 0.0) { int row = int(e2.w); c = vec3(curve1(row, c.r, 0), curve1(row, c.g, 1), curve1(row, c.b, 2)); }
    float v = e1.w;
    if (v != 0.0) {
        vec3 lin = decode3(c);
        float y = dot(luma, lin);
        float k = 1.0 + v;
        if (v > 0.0) {
            float most = 1e30;
            for (int ch = 0; ch < 3; ch++) {
                if (lin[ch] > y + 1e-7) most = min(most, (1.0 - y) / (lin[ch] - y));
                else if (lin[ch] < y - 1e-7) most = min(most, y / (y - lin[ch]));
            }
            float room = most - 1.0;
            k = room > 1e4 ? 1.0 + v : room <= 0.0 ? 1.0 : 1.0 + room * (1.0 - exp(-v / room));
        }
        c = encode3(clamp(vec3(y) + (lin - vec3(y)) * k, 0.0, 1.0));
    }
    int colors = int(entry(base + 6).w);
    if (colors > 0) {
        float y = dot(luma, c);
        float x = c.r - (c.g + c.b) / 2.0;
        float z = 0.8660254037844386 * (c.g - c.b);
        float hue = atan(z, x);
        float chroma = length(vec2(x, z));
        float turn = 0.0;
        float scale = 1.0;
        float lift = 0.0;
        for (int i = 0; i < 3; i++) {
            if (i >= colors) break;
            vec4 each = entry(base + 7 + i);
            float w = near(hue, chroma, each.x);
            turn += each.y * w;
            scale *= 1.0 + each.z * w;
            lift += each.w * w;
        }
        if (turn == 0.0 && scale == 1.0 && lift == 0.0) return finish(base, c);
        float now = hue + turn;
        vec3 sum = vec3(y + lift, chroma * scale * cos(now), chroma * scale * sin(now));
        c = vec3(dot(backR, sum), dot(backG, sum), dot(backB, sum));
    }
    return finish(base, c);
}
float maskAt(int layer, vec2 place) {
    vec2 u = place * maskSize / pictureSize - 0.5;
    vec2 low = floor(u);
    vec2 f = u - low;
    ivec2 a = ivec2(clamp(low, vec2(0.0), maskSize - 1.0));
    ivec2 b = ivec2(clamp(low + 1.0, vec2(0.0), maskSize - 1.0));
    float m00 = texelFetch(gradeMasks, ivec3(a.x, a.y, layer), 0).r;
    float m10 = texelFetch(gradeMasks, ivec3(b.x, a.y, layer), 0).r;
    float m01 = texelFetch(gradeMasks, ivec3(a.x, b.y, layer), 0).r;
    float m11 = texelFetch(gradeMasks, ivec3(b.x, b.y, layer), 0).r;
    return mix(mix(m00, m10, f.x), mix(m01, m11, f.x), f.y);
}
vec3 graded(vec3 c, vec2 place) {
    for (int k = 0; k < ${MOST_GRADES}; k++) {
        if (k >= gradeCount) break;
        int base = int(entry(k).x);
        vec4 masked = entry(base + 10);
        float m = 1.0;
        if (masked.x >= 0.0) {
            m = clamp(maskAt(int(masked.x), place), 0.0, 1.0);
            if (masked.y == 1.0) m = 1.0 - m;
        }
        if (m <= 0.0) continue;
        vec3 g = gradeOne(c, base);
        c = m >= 1.0 ? g : c + (g - c) * m;
    }
    return c;
}
`;

/** The grade in WGSL for WebGPU, the same sums: `graded(color, place)`. Its bindings are `@group(1)`, set by gpu.ts. */
export const GRADE_WGSL = /* wgsl */ `
struct Grading { luma: vec4f, backR: vec4f, backG: vec4f, backB: vec4f, maskSize: vec2f, pictureSize: vec2f, count: i32, layers: i32, pad: vec2f };
@group(1) @binding(0) var<uniform> grading: Grading;
@group(1) @binding(1) var<storage, read> gradeData: array<vec4f>;
@group(1) @binding(2) var<storage, read> gradeMasks: array<f32>;
const PIVOT = ${Math.fround(1.055 * Math.pow(0.18, 1 / 2.4) - 0.055).toFixed(9)};
fn entry(i: i32) -> vec4f { return gradeData[i]; }
fn encode1(x: f32) -> f32 { if (x <= 0.0031308) { return 12.92 * x; } return 1.055 * pow(x, 1.0 / 2.4) - 0.055; }
fn decode1(v: f32) -> f32 { if (v <= 0.04045) { return v / 12.92; } return pow((v + 0.055) / 1.055, 2.4); }
fn encode3(x: vec3f) -> vec3f { return vec3f(encode1(x.r), encode1(x.g), encode1(x.b)); }
fn decode3(v: vec3f) -> vec3f { return vec3f(decode1(v.r), decode1(v.g), decode1(v.b)); }
fn power(x: f32, y: f32) -> f32 { if (x <= 0.0) { return 0.0; } return pow(x, y); }
fn bump(p: f32) -> f32 { return p * (1.0 - p) * (1.0 - p) * (1.0 - p) / 0.10546875; }
fn contrast1(p: f32, a: f32) -> f32 {
    if (p < PIVOT) { return PIVOT * power(clamp(p, 0.0, 1.0) / PIVOT, a); }
    return 1.0 - (1.0 - PIVOT) * power(clamp(1.0 - p, 0.0, 1.0) / (1.0 - PIVOT), a);
}
fn curve1(row: i32, p: f32, channel: i32) -> f32 {
    let t = clamp(p, 0.0, 1.0) * ${CURVE - 1}.0;
    let at = min(${CURVE - 2}.0, floor(t));
    return mix(entry(row + i32(at))[channel], entry(row + i32(at) + 1)[channel], t - at);
}
fn near(hue: f32, chroma: f32, picked: f32) -> f32 {
    var d = abs(hue - picked) % 6.283185307179586;
    if (d > 3.141592653589793) { d = 6.283185307179586 - d; }
    var n = 0.0;
    if (d < 0.5235987755982988) { n = 1.0; } else if (d < 1.0471975511965976) { n = 0.5 + 0.5 * cos((d - 0.5235987755982988) * 6.0); }
    return n * smoothstep(0.02, 0.1, chroma);
}
fn look3(base: i32, c: vec3f) -> vec3f {
    let kind = entry(base + 3).w;
    let n = entry(base + 4).w;
    let lowRow = entry(base + 5);
    let high = entry(base + 6).xyz;
    let row = i32(lowRow.w);
    let place = clamp((c - lowRow.xyz) / (high - lowRow.xyz), vec3f(0.0), vec3f(1.0)) * (n - 1.0);
    if (kind == 2.0) {
        var o = vec3f(0.0);
        for (var ch = 0; ch < 3; ch++) {
            let at = min(n - 2.0, floor(place[ch]));
            o[ch] = mix(entry(row + i32(at))[ch], entry(row + i32(at) + 1)[ch], place[ch] - at);
        }
        return o;
    }
    let low = min(vec3f(n - 2.0), floor(place));
    let part = place - low;
    let size = i32(n);
    var o = vec3f(0.0);
    for (var corner = 0; corner < 8; corner++) {
        let bit = vec3i(corner & 1, (corner >> 1u) & 1, (corner >> 2u) & 1);
        let w = select(1.0 - part.x, part.x, bit.x == 1) * select(1.0 - part.y, part.y, bit.y == 1) * select(1.0 - part.z, part.z, bit.z == 1);
        let at = vec3i(low) + bit;
        o += w * entry(row + at.x + size * (at.y + size * at.z)).rgb;
    }
    return o;
}
fn finish(base: i32, given: vec3f) -> vec3f {
    var c = given;
    if (entry(base + 3).w != 0.0) { c = look3(base, clamp(c, vec3f(0.0), vec3f(1.0))); }
    return clamp(c, vec3f(0.0), vec3f(1.0));
}
fn gradeOne(given: vec3f, base: i32) -> vec3f {
    var c = given;
    let e0 = entry(base);
    let e1 = entry(base + 1);
    let gains = e0.rgb;
    let g = e0.w;
    let luma = grading.luma.xyz;
    if (any(gains != vec3f(1.0)) || g != 1.0) {
        var lin = decode3(c);
        if (any(gains != vec3f(1.0))) { lin = clamp(lin * gains, vec3f(0.0), vec3f(1.0)); }
        if (g > 1.0) { lin = vec3f(1.0) - vec3f(power(1.0 - clamp(lin.r, 0.0, 1.0), g), power(1.0 - clamp(lin.g, 0.0, 1.0), g), power(1.0 - clamp(lin.b, 0.0, 1.0), g)); }
        else if (g < 1.0) { lin = lin * g; }
        c = encode3(lin);
    }
    if (e1.x != 1.0) { c = vec3f(contrast1(c.r, e1.x), contrast1(c.g, e1.x), contrast1(c.b, e1.x)); }
    if (e1.y != 0.0) { c = c + e1.y * vec3f(bump(clamp(c.r, 0.0, 1.0)), bump(clamp(c.g, 0.0, 1.0)), bump(clamp(c.b, 0.0, 1.0))); }
    if (e1.z != 0.0) { c = vec3f(1.0) - (vec3f(1.0) - c + e1.z * vec3f(bump(clamp(1.0 - c.r, 0.0, 1.0)), bump(clamp(1.0 - c.g, 0.0, 1.0)), bump(clamp(1.0 - c.b, 0.0, 1.0)))); }
    let e2 = entry(base + 2);
    let ws = e2.rgb;
    let wm = entry(base + 3).rgb;
    let wh = entry(base + 4).rgb;
    if (any(ws != vec3f(0.0)) || any(wm != vec3f(0.0)) || any(wh != vec3f(0.0))) {
        let y = clamp(dot(luma, c), 0.0, 1.0);
        let low = (1.0 - y) * (1.0 - y);
        let high = y * y;
        c = c + low * ws + (1.0 - low - high) * wm + high * wh;
    }
    c = clamp(c, vec3f(0.0), vec3f(1.0));
    if (e2.w >= 0.0) { let row = i32(e2.w); c = vec3f(curve1(row, c.r, 0), curve1(row, c.g, 1), curve1(row, c.b, 2)); }
    let v = e1.w;
    if (v != 0.0) {
        let lin = decode3(c);
        let y = dot(luma, lin);
        var k = 1.0 + v;
        if (v > 0.0) {
            var most = 1e30;
            for (var ch = 0; ch < 3; ch++) {
                if (lin[ch] > y + 1e-7) { most = min(most, (1.0 - y) / (lin[ch] - y)); }
                else if (lin[ch] < y - 1e-7) { most = min(most, y / (y - lin[ch])); }
            }
            let room = most - 1.0;
            if (room > 1e4) { k = 1.0 + v; } else if (room <= 0.0) { k = 1.0; } else { k = 1.0 + room * (1.0 - exp(-v / room)); }
        }
        c = encode3(clamp(vec3f(y) + (lin - vec3f(y)) * k, vec3f(0.0), vec3f(1.0)));
    }
    let colors = i32(entry(base + 6).w);
    if (colors > 0) {
        let y = dot(luma, c);
        let x = c.r - (c.g + c.b) / 2.0;
        let z = 0.8660254037844386 * (c.g - c.b);
        let hue = atan2(z, x);
        let chroma = length(vec2f(x, z));
        var turn = 0.0;
        var scale = 1.0;
        var lift = 0.0;
        for (var i = 0; i < 3; i++) {
            if (i >= colors) { break; }
            let each = entry(base + 7 + i);
            let w = near(hue, chroma, each.x);
            turn += each.y * w;
            scale *= 1.0 + each.z * w;
            lift += each.w * w;
        }
        if (turn == 0.0 && scale == 1.0 && lift == 0.0) { return finish(base, c); }
        let now = hue + turn;
        let sum = vec3f(y + lift, chroma * scale * cos(now), chroma * scale * sin(now));
        c = vec3f(dot(grading.backR.xyz, sum), dot(grading.backG.xyz, sum), dot(grading.backB.xyz, sum));
    }
    return finish(base, c);
}
fn maskTexel(layer: i32, x: i32, y: i32) -> f32 {
    let size = vec2i(grading.maskSize);
    return gradeMasks[(layer * size.y + y) * size.x + x];
}
fn maskAt(layer: i32, place: vec2f) -> f32 {
    let u = place * grading.maskSize / grading.pictureSize - 0.5;
    let low = floor(u);
    let f = u - low;
    let a = vec2i(clamp(low, vec2f(0.0), grading.maskSize - 1.0));
    let b = vec2i(clamp(low + 1.0, vec2f(0.0), grading.maskSize - 1.0));
    return mix(mix(maskTexel(layer, a.x, a.y), maskTexel(layer, b.x, a.y), f.x), mix(maskTexel(layer, a.x, b.y), maskTexel(layer, b.x, b.y), f.x), f.y);
}
fn graded(given: vec3f, place: vec2f) -> vec3f {
    var c = given;
    for (var k = 0; k < ${MOST_GRADES}; k++) {
        if (k >= grading.count) { break; }
        let base = i32(entry(k).x);
        let masked = entry(base + 10);
        var m = 1.0;
        if (masked.x >= 0.0 && grading.layers > 0) {
            m = clamp(maskAt(i32(masked.x), place), 0.0, 1.0);
            if (masked.y == 1.0) { m = 1.0 - m; }
        }
        if (m <= 0.0) { continue; }
        let g = gradeOne(c, base);
        if (m >= 1.0) { c = g; } else { c = c + (g - c) * m; }
    }
    return c;
}
`;

/** The mask a reference grading reads, as the shaders read it: a layer of a stack, between its entries by straight lines, its places in the original's pixels. */
export function maskReader(layer: Float32Array, size: { width: number; height: number }, picture: { width: number; height: number }) {
    const f = Math.fround;
    const sx = f(size.width / picture.width);
    const sy = f(size.height / picture.height);
    return (x: number, y: number): number => {
        const u = f(x * sx) - 0.5;
        const v = f(y * sy) - 0.5;
        const lowX = Math.floor(u);
        const lowY = Math.floor(v);
        const fx = u - lowX;
        const fy = v - lowY;
        const at = (column: number, row: number) => layer[Math.min(size.height - 1, Math.max(0, row)) * size.width + Math.min(size.width - 1, Math.max(0, column))]!;
        const top = at(lowX, lowY) + (at(lowX + 1, lowY) - at(lowX, lowY)) * fx;
        const bottom = at(lowX, lowY + 1) + (at(lowX + 1, lowY + 1) - at(lowX, lowY + 1)) * fx;
        return Math.min(1, Math.max(0, top + (bottom - top) * fy));
    };
}
