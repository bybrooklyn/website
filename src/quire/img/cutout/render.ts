// The cut-out made at the picture's full size on the card, through WebGL2 written by hand: each pixel
// worked out as refine.ts's `applyOne` says (its mask from the guided plane at its color, its color
// with the old background taken out, laid on the background chosen), the picture read in pieces of at
// most 2048 a side so that a 50 megapixel photograph never sits on the card whole. The numbers at the
// mask's size are float textures read between their entries by hand, as the processor reads them, so
// the two agree. `cutHere` does the same on the processor, for a browser without WebGL2 and for tests.
//
//   const pixels = await renderCut(bitmap, low, { kind: "clear" });

import { applyOne, colorOf, FAINT, readLow, SURE, type Background, type Low } from "./refine";

/** The largest piece of the picture drawn at once. */
export const CUT_PIECE = 2048;

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D piece;
uniform highp sampler2D lines;
uniform highp sampler2D kept;
uniform highp sampler2D ground;
uniform highp sampler2D behind;
uniform highp sampler2D levels;
uniform vec2 at;
uniform vec2 whole;
uniform int lay;
uniform vec3 under;
out vec4 color;
// a low texture read between its four nearest entries, at a share of the picture
vec4 low(highp sampler2D plane, vec2 share) {
    vec2 size = vec2(textureSize(plane, 0));
    vec2 p = share * size - 0.5;
    vec2 l = floor(p);
    vec2 f = p - l;
    ivec2 a = ivec2(clamp(l, vec2(0.0), size - 1.0));
    ivec2 b = ivec2(clamp(l + 1.0, vec2(0.0), size - 1.0));
    vec4 upper = mix(texelFetch(plane, ivec2(a.x, a.y), 0), texelFetch(plane, ivec2(b.x, a.y), 0), f.x);
    vec4 lower = mix(texelFetch(plane, ivec2(a.x, b.y), 0), texelFetch(plane, ivec2(b.x, b.y), 0), f.x);
    return mix(upper, lower, f.y);
}
void main() {
    ivec2 here = ivec2(gl_FragCoord.xy);
    vec3 rgb = texelFetch(piece, here, 0).rgb;
    vec2 share = (at + vec2(here) + 0.5) / whole;
    vec4 plane = low(lines, share);
    float alpha = clamp(dot(plane.rgb, rgb) + plane.a, 0.0, 1.0);
    vec2 level = low(levels, share).xy;
    alpha = clamp((alpha - level.x) / max(0.05, level.y - level.x), 0.0, 1.0);
    vec3 near = low(kept, share).rgb;
    vec3 old = low(ground, share).rgb;
    vec3 solved = alpha > ${FAINT} ? clamp((rgb - (1.0 - alpha) * old) / alpha, 0.0, 1.0) : near;
    float t = clamp((alpha - ${FAINT}) / (${SURE} - ${FAINT}), 0.0, 1.0);
    vec3 keep = near + (solved - near) * (t * t * (3.0 - 2.0 * t));
    if (lay == 0) { color = vec4(keep, alpha); return; }
    vec3 back = lay == 1 ? under : low(behind, share).rgb;
    color = vec4(keep * alpha + back * (1.0 - alpha), 1.0);
}`;

/** The old picture blurred, small, for a blurred background: made a fiftieth or so of its size and averaged, read between its entries when laid under. */
export interface Behind {
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
}

/** The cut-out at full size, on the card: RGBA, straight alpha, row by row from the top. Falls back to the processor where there is no WebGL2. */
export async function renderCut(full: ImageBitmap, low: Low, background: Background, color = "#ffffff", behind?: Behind): Promise<ImageData> {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false }) as WebGL2RenderingContext | null;
    if (!gl) return cutHere(full, low, background, color, behind);
    const shader = (type: number, source: string) => {
        const made = gl.createShader(type)!;
        gl.shaderSource(made, source);
        gl.compileShader(made);
        if (!gl.getShaderParameter(made, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(made) ?? "the cut-out's shader did not compile");
        return made;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.bindAttribLocation(program, 0, "corner");
    gl.linkProgram(program);
    gl.useProgram(program);
    const square = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, square);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const texture = (unit: number, name: string, make: () => void) => {
        const made = gl.createTexture()!;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, made);
        for (const [key, value] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, key, value);
        make();
        gl.uniform1i(gl.getUniformLocation(program, name), unit);
        return made;
    };
    const floats = (values: Float32Array, channels: number) => {
        const out = new Float32Array(low.width * low.height * 4);
        for (let at = 0; at < low.width * low.height; at++) for (let c = 0; c < channels; c++) out[at * 4 + c] = values[at * channels + c]!;
        return out;
    };
    const lines = new Float32Array(low.width * low.height * 4);
    for (let at = 0; at < low.width * low.height; at++) {
        for (let c = 0; c < 3; c++) lines[at * 4 + c] = low.a[at * 3 + c]!;
        lines[at * 4 + 3] = low.b[at]!;
    }
    const made = [
        texture(1, "lines", () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, low.width, low.height, 0, gl.RGBA, gl.FLOAT, lines)),
        texture(2, "kept", () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, low.width, low.height, 0, gl.RGBA, gl.FLOAT, floats(low.kept, 3))),
        texture(3, "ground", () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, low.width, low.height, 0, gl.RGBA, gl.FLOAT, floats(low.ground, 3))),
        texture(6, "levels", () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, low.width, low.height, 0, gl.RGBA, gl.FLOAT, floats(low.levels, 2))),
        texture(4, "behind", () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, behind?.width ?? 1, behind?.height ?? 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, behind?.rgba ?? new Uint8Array(4))),
    ];
    gl.uniform2f(gl.getUniformLocation(program, "whole"), full.width, full.height);
    gl.uniform1i(gl.getUniformLocation(program, "lay"), background.kind === "clear" ? 0 : background.kind === "color" ? 1 : 2);
    gl.uniform3f(gl.getUniformLocation(program, "under"), ...colorOf(color));
    const result = new ImageData(full.width, full.height);
    for (let y = 0; y < full.height; y += CUT_PIECE)
        for (let x = 0; x < full.width; x += CUT_PIECE) {
            const width = Math.min(CUT_PIECE, full.width - x);
            const height = Math.min(CUT_PIECE, full.height - y);
            const part = await createImageBitmap(full, x, y, width, height, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
            const piece = texture(0, "piece", () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, part));
            part.close();
            const out = gl.createTexture()!;
            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, out);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            const frame = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
            gl.viewport(0, 0, width, height);
            gl.uniform2f(gl.getUniformLocation(program, "at"), x, y);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            const pixels = new Uint8Array(width * height * 4);
            gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            for (let row = 0; row < height; row++) result.data.set(pixels.subarray(row * width * 4, (row + 1) * width * 4), ((y + row) * full.width + x) * 4);
            gl.deleteFramebuffer(frame);
            gl.deleteTexture(out);
            gl.deleteTexture(piece);
        }
    for (const each of made) gl.deleteTexture(each);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return result;
}

/** The cut-out at full size on the processor, pixel by pixel as `applyOne` says: the card's way, for a browser without WebGL2 and for tests. */
export async function cutHere(full: ImageBitmap, low: Low, background: Background, color = "#ffffff", behind?: Behind): Promise<ImageData> {
    const canvas = new OffscreenCanvas(full.width, full.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(full, 0, 0);
    const source = context.getImageData(0, 0, full.width, full.height).data;
    return cutPixels(source, full.width, full.height, low, background, color, behind);
}

/** The cut-out of pixels already read (RGBA, 8 bits), on the processor. */
export function cutPixels(source: ArrayLike<number>, width: number, height: number, low: Low, background: Background, color = "#ffffff", behind?: Behind): ImageData {
    const result = new ImageData(width, height);
    const under = colorOf(color);
    const plane = behind ? Float32Array.from(behind.rgba, (value) => value / 255) : undefined;
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const at = (y * width + x) * 4;
            const u = (x + 0.5) / width;
            const v = (y + 0.5) / height;
            const back: [number, number, number] = behind && plane ? ([0, 1, 2].map((c) => readLow(plane, behind.width, behind.height, u, v, 4, c)) as [number, number, number]) : [0, 0, 0];
            const pixel = applyOne(low, [source[at]! / 255, source[at + 1]! / 255, source[at + 2]! / 255], u, v, background, under, back);
            for (let c = 0; c < 4; c++) result.data[at + c] = Math.round(pixel[c]! * 255);
        }
    return result;
}
