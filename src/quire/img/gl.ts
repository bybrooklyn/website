// The picture drawn through WebGL2, for browsers without WebGPU (gpu.ts is the other way, and
// draw.ts says what the two share). Two small programs: one draws images and solid rectangles on
// the screen, the other resamples a piece of the picture along one axis by the resize's filter. Both
// grade as they go when given a grade (grade-shader.ts): the screen each pixel drawn, the resampler
// in its pass down, before the result is rounded.

import { grownQuad, type Backend, type Drawn, type Fill, type Grading, type Piece, type PieceCover, type Quad, type ScreenGrade, type Texture, type TurnPass } from "./draw";
import type { Rect } from "./steps";
import { GRADE_GLSL, ROW } from "./grade-shader";

// a rectangle, or four corners (`quadOn`: the top left and top right in quadA, the bottom left and bottom right in quadB);
// `flip` is -1 when drawing into a texture, whose first row is the picture's top
const SCREEN = `#version 300 es
in vec2 corner;
uniform vec4 to;
uniform vec2 canvas;
uniform int quadOn;
uniform vec4 quadA;
uniform vec4 quadB;
uniform float flip;
out vec2 place;
void main() {
    place = corner;
    vec2 at = quadOn == 1 ? mix(mix(quadA.xy, quadA.zw, corner.x), mix(quadB.xy, quadB.zw, corner.x), corner.y) : to.xy + corner * to.zw;
    gl_Position = vec4(at.x / canvas.x * 2.0 - 1.0, flip * (1.0 - at.y / canvas.y * 2.0), 0.0, 1.0);
}`;

// with no grade the programs are built with a `graded` that gives the color back, so that drawing without one costs what it did
const UNGRADED = "vec3 graded(vec3 c, vec2 place) { return c; } vec3 converted(vec3 c) { return c; }";

const PAINT = (grading: boolean) => `#version 300 es
precision highp float;
precision highp int;
in vec2 place;
uniform sampler2D image;
uniform vec4 fill;
uniform int grade;
uniform vec4 toOriginal;
uniform float split;
uniform float canvasHeight;
out vec4 color;
${grading ? GRADE_GLSL : UNGRADED}
void main() {
    vec4 found = fill.a >= 0.0 ? fill : texture(image, place);
    if (grade == 1) {
        vec2 at = vec2(gl_FragCoord.x, canvasHeight - gl_FragCoord.y);
        // left of the split the original, made sRGB all the same where the screen asks it
        found.rgb = at.x >= split ? graded(clamp(found.rgb, 0.0, 1.0), toOriginal.xy + at * toOriginal.zw) : converted(clamp(found.rgb, 0.0, 1.0));
    }
    color = vec4(found.rgb * found.a, found.a);
}`;

const WHOLE = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0); }`;

// one pass of resampling: each pixel of the result is the filter's weighted sum of the samples of
// the input along one axis, read only between low and high, so that nothing past the crop is read
const RESAMPLE = (grading: boolean) => `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D source;
uniform int axis;
uniform int curve;
uniform float start;
uniform float step;
uniform float low;
uniform float high;
uniform float support;
uniform float scale;
uniform int grade;
uniform vec4 toOriginal;
out vec4 color;
${grading ? GRADE_GLSL : UNGRADED}
float weight(float x) {
    x = abs(x);
    if (curve == 1) return max(0.0, 1.0 - x);
    if (x < 1e-5) return 1.0;
    if (x >= 3.0) return 0.0;
    float p = 3.14159265358979 * x;
    return 3.0 * sin(p) * sin(p / 3.0) / (p * p);
}
vec4 read(float t, ivec2 at) {
    int i = int(clamp(t, low, high));
    return texelFetch(source, axis == 0 ? ivec2(i, at.y) : ivec2(at.x, i), 0);
}
vec4 sampled(ivec2 at) {
    float center = start + float(axis == 0 ? at.x : at.y) * step;
    // nearest: a sample exactly half way between two pixels falls the same way in every implementation
    if (curve == 2) return read(floor(center + 0.501), at);
    vec4 sum = vec4(0.0);
    float total = 0.0;
    float first = ceil(center - support);
    for (int i = 0; i < 4096; i++) {
        float t = first + float(i);
        if (t > center + support) break;
        float w = weight((t - center) * scale);
        sum += w * read(t, at);
        total += w;
    }
    return sum / total;
}
void main() {
    ivec2 at = ivec2(gl_FragCoord.xy);
    vec4 found = sampled(at);
    // the pass down grades the pixel it makes, before it is rounded
    if (grade == 1) found.rgb = graded(clamp(found.rgb, 0.0, 1.0), toOriginal.xy + (vec2(at) + 0.5) * toOriginal.zw);
    color = found;
}`;

// a piece of the original turned upright: each pixel of the level piece reads the original about its place there, by a
// Lanczos filter of six by six at one to one, between the edges of the part given
const TURN = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D source;
uniform vec4 turn;
uniform vec2 back;
out vec4 color;
float lanczos(float given) {
    float x = abs(given);
    if (x < 1e-5) return 1.0;
    if (x >= 3.0) return 0.0;
    float p = 3.14159265358979 * x;
    return 3.0 * sin(p) * sin(p / 3.0) / (p * p);
}
void main() {
    vec2 q = turn.zw + floor(gl_FragCoord.xy) + 0.5;
    vec2 u = vec2(turn.x * q.x + turn.y * q.y, -turn.y * q.x + turn.x * q.y) + back;
    ivec2 size = textureSize(source, 0);
    vec2 first = floor(u) - 2.0;
    float wx[6];
    float wy[6];
    for (int i = 0; i < 6; i++) { wx[i] = lanczos(first.x + float(i) - u.x); wy[i] = lanczos(first.y + float(i) - u.y); }
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int j = 0; j < 6; j++) for (int i = 0; i < 6; i++) {
        ivec2 at = clamp(ivec2(first) + ivec2(i, j), ivec2(0), size - 1);
        float w = wx[i] * wy[j];
        sum += w * texelFetch(source, at, 0);
        total += w;
    }
    color = sum / total;
}`;

/** The filters by their number in the shaders. */
const FILTERS = { lanczos: 0, bilinear: 1, nearest: 2 } as const;

/** WebGL2 on a canvas, or undefined where the browser has none. */
export function webgl2(canvas: HTMLCanvasElement | OffscreenCanvas): Backend | undefined {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true }) as WebGL2RenderingContext | null;
    if (!gl) return undefined;
    const program = (vertex: string, fragment: string) => {
        const made = gl.createProgram()!;
        for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
            const shader = gl.createShader(type)!;
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "a shader did not compile");
            gl.attachShader(made, shader);
        }
        gl.bindAttribLocation(made, 0, "corner");
        gl.linkProgram(made);
        if (!gl.getProgramParameter(made, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(made) ?? "a program did not link");
        const places = new Map<string, WebGLUniformLocation | null>();
        return { made, at: (name: string) => (places.has(name) ? places.get(name)! : places.set(name, gl.getUniformLocation(made, name)).get(name)!) };
    };
    const plain = program(SCREEN, PAINT(false));
    const resampling = program(WHOLE, RESAMPLE(false));
    const screenGraded = program(SCREEN, PAINT(true));
    const resamplerGraded = program(WHOLE, RESAMPLE(true));
    const turning = program(WHOLE, TURN);
    for (const made of [plain, screenGraded]) {
        gl.useProgram(made.made);
        gl.uniform1f(made.at("flip"), 1);
    }
    // one square, two triangles, from 0 to 1, for every draw
    const square = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, square);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const textures = new WeakMap<Texture, WebGLTexture>();
    // the grades' numbers on unit 1 and the parts' masks on unit 2, kept until they change
    const gradeData = gl.createTexture()!;
    const gradeMasks = gl.createTexture()!;
    let gradeRows = 0;
    let given: Grading | undefined;
    let masksGiven: Grading["masks"] | null = null;
    const setFloat = (target: number, texture: WebGLTexture) => {
        gl.bindTexture(target, texture);
        for (const [name, value] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST]]) gl.texParameteri(target, name, value);
    };
    setFloat(gl.TEXTURE_2D_ARRAY, gradeMasks);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R32F, 1, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array(1));
    setFloat(gl.TEXTURE_2D, gradeData);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROW, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(ROW * 4));
    // the grade's samplers are on units of their own from the start, so that they never share unit 0 with the picture, which WebGL refuses
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, gradeData);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, gradeMasks);
    gl.activeTexture(gl.TEXTURE0);
    for (const made of [screenGraded, resamplerGraded]) {
        gl.useProgram(made.made);
        gl.uniform1i(made.at("gradeData"), 1);
        gl.uniform1i(made.at("gradeMasks"), 2);
    }
    /** Points a program's grade at the numbers and masks, or tells it not to grade. */
    const gradeUniforms = (made: ReturnType<typeof program>, on: boolean) => {
        gl.uniform1i(made.at("grade"), on && given ? 1 : 0);
        if (!on || !given) return;
        gl.uniform1i(made.at("gradeCount"), given.packed.count);
        const { luma, back } = given.numbers;
        gl.uniform3f(made.at("luma"), luma[0], luma[1], luma[2]);
        gl.uniform3f(made.at("backR"), back[0]!, back[1]!, back[2]!);
        gl.uniform3f(made.at("backG"), back[3]!, back[4]!, back[5]!);
        gl.uniform3f(made.at("backB"), back[6]!, back[7]!, back[8]!);
        const masks = given.masks;
        gl.uniform2f(made.at("maskSize"), masks?.width ?? 1, masks?.height ?? 1);
        gl.uniform2f(made.at("pictureSize"), given.picture.width, given.picture.height);
        gl.uniform1i(made.at("gradeConvert"), given.convert ? 1 : 0);
        gl.uniform4f(made.at("gradeTurn"), ...(given.turn ?? [1, 0, 0, 0]));
    };

    // half floats can be drawn into where the card allows it, so that a graded picture is never held in 8 bits between the passes
    const halves = !!gl.getExtension("EXT_color_buffer_float");
    const store = (width: number, height: number, image?: ImageBitmap, small = false, half = false): WebGLTexture => {
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
        else if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        if (small) gl.generateMipmap(gl.TEXTURE_2D);
        for (const [name, value] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST]]) gl.texParameteri(gl.TEXTURE_2D, name, value);
        return texture;
    };
    const target = (texture: WebGLTexture) => {
        const frame = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        return frame;
    };
    /** Draws the next shape at four corners, or as its rectangle when there are none. */
    const corners = (made: ReturnType<typeof program>, quad: Quad | undefined) => {
        gl.uniform1i(made.at("quadOn"), quad ? 1 : 0);
        if (!quad) return;
        gl.uniform4f(made.at("quadA"), quad[0], quad[1], quad[2], quad[3]);
        gl.uniform4f(made.at("quadB"), quad[4], quad[5], quad[6], quad[7]);
    };
    /** Clips to a rectangle given from the top, in the window's own way of counting from the bottom when drawing to the screen. */
    const scissor = (rect: Rect, height: number, fromTop: boolean) => {
        const x = Math.max(0, Math.floor(rect.x));
        const y = Math.max(0, Math.floor(rect.y));
        const width = Math.max(0, Math.ceil(rect.x + rect.width) - x);
        const tall = Math.max(0, Math.ceil(rect.y + rect.height) - y);
        gl.scissor(x, fromTop ? height - y - tall : y, width, tall);
    };

    return {
        name: "WebGL2",
        colors(space) {
            // a browser without the setting draws in sRGB alone
            const drawing = gl as WebGL2RenderingContext & { drawingBufferColorSpace?: string };
            if (!("drawingBufferColorSpace" in drawing)) return space === "srgb";
            drawing.drawingBufferColorSpace = space;
            return drawing.drawingBufferColorSpace === space;
        },
        most: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        texture(image) {
            const made = { width: image.width, height: image.height };
            textures.set(made, store(image.width, image.height, image, true));
            return made;
        },
        free(texture) {
            const found = textures.get(texture);
            if (found) gl.deleteTexture(found);
            textures.delete(texture);
        },
        grading(next) {
            if (next === given) return;
            given = next;
            if (!next) return;
            gl.activeTexture(gl.TEXTURE1);
            if (next.packed.rows !== gradeRows) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROW, next.packed.rows, 0, gl.RGBA, gl.FLOAT, next.packed.data);
                gradeRows = next.packed.rows;
            } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROW, next.packed.rows, gl.RGBA, gl.FLOAT, next.packed.data);
            if (next.masks !== masksGiven) {
                masksGiven = next.masks;
                const masks = next.masks;
                gl.activeTexture(gl.TEXTURE2);
                if (masks && masks.layers.length) {
                    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R32F, masks.width, masks.height, masks.layers.length, 0, gl.RED, gl.FLOAT, null);
                    masks.layers.forEach((layer, at) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, at, masks.width, masks.height, 1, gl.RED, gl.FLOAT, layer));
                } else gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R32F, 1, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array(1));
            }
            gl.activeTexture(gl.TEXTURE0);
        },
        draw(images: Drawn[], fills: Fill[], clip?: Rect, graded?: ScreenGrade) {
            const { width, height } = canvas;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, width, height);
            gl.disable(gl.SCISSOR_TEST);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            const screen = graded && given ? screenGraded : plain;
            gl.useProgram(screen.made);
            gl.uniform2f(screen.at("canvas"), width, height);
            gl.uniform1f(screen.at("canvasHeight"), height);
            gradeUniforms(screen, !!graded);
            if (graded) {
                gl.uniform4f(screen.at("toOriginal"), ...graded.toOriginal);
                gl.uniform1f(screen.at("split"), graded.split);
            }
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            if (clip) {
                gl.enable(gl.SCISSOR_TEST);
                scissor(clip, height, true);
            }
            gl.activeTexture(gl.TEXTURE0);
            gl.uniform1i(screen.at("image"), 0);
            for (const image of images) {
                const texture = textures.get(image.texture);
                if (!texture) continue;
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, image.sharp ? gl.NEAREST : gl.LINEAR_MIPMAP_LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, image.sharp ? gl.NEAREST : gl.LINEAR);
                gl.uniform1i(screen.at("grade"), graded && given ? 1 : 0);
                gl.uniform4f(screen.at("fill"), 0, 0, 0, -1);
                gl.uniform4f(screen.at("to"), image.to.x, image.to.y, image.to.width, image.to.height);
                corners(screen, image.quad);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
            for (const fill of fills) {
                // a dimming shape darkens what is drawn and leaves the canvas's clear places clear
                if (fill.dim) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.uniform1i(screen.at("grade"), graded && given && fill.graded ? 1 : 0);
                gl.uniform4f(screen.at("fill"), ...fill.color);
                gl.uniform4f(screen.at("to"), fill.rect.x, fill.rect.y, fill.rect.width, fill.rect.height);
                corners(screen, fill.quad);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
            gl.disable(gl.SCISSOR_TEST);
            gl.disable(gl.BLEND);
        },
        async resample(part, covers: PieceCover[], piece: Piece, graded?: [number, number, number, number], turned?: TurnPass) {
            const input = store(part.width, part.height, part);
            const frames: WebGLFramebuffer[] = [target(input)];
            // the covers painted straight into the piece read, so that what they hide is gone before any of it is sampled
            gl.enable(gl.SCISSOR_TEST);
            for (const cover of covers.filter((each) => !each.angle)) {
                scissor(cover.rect, part.height, false);
                gl.clearColor(...cover.color);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            gl.disable(gl.SCISSOR_TEST);
            gl.disable(gl.BLEND);
            // a cover turned on its own: its four corners, grown by half a pixel's diagonal, drawn into the piece
            const turnedCovers = covers.filter((each) => each.angle);
            if (turnedCovers.length) {
                gl.viewport(0, 0, part.width, part.height);
                gl.useProgram(plain.made);
                gl.uniform2f(plain.at("canvas"), part.width, part.height);
                gl.uniform1f(plain.at("flip"), -1);
                gl.uniform1i(plain.at("grade"), 0);
                // the piece is what is drawn into, so it must not also be what the program could read, which WebGL refuses
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, null);
                for (const cover of turnedCovers) {
                    gl.uniform4f(plain.at("fill"), ...cover.color);
                    corners(plain, grownQuad(cover));
                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                }
                gl.uniform1f(plain.at("flip"), 1);
                corners(plain, undefined);
            }
            gl.activeTexture(gl.TEXTURE0);
            // turned, the piece is first made upright: the level piece read from the original's part
            let level = input;
            if (turned) {
                level = store(turned.width, turned.height, undefined, false, !!graded && !!given && halves);
                frames.push(target(level));
                gl.viewport(0, 0, turned.width, turned.height);
                gl.useProgram(turning.made);
                gl.uniform1i(turning.at("source"), 0);
                gl.uniform4f(turning.at("turn"), turned.cos, turned.sin, turned.from[0], turned.from[1]);
                gl.uniform2f(turning.at("back"), turned.back[0], turned.back[1]);
                gl.bindTexture(gl.TEXTURE_2D, input);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
            const pass = (from: WebGLTexture, width: number, height: number, axis: 0 | 1) => {
                const resampler = axis === 1 && graded && given ? resamplerGraded : resampling;
                gl.useProgram(resampler.made);
                gl.uniform1i(resampler.at("source"), 0);
                const into = store(width, height, undefined, false, axis === 0 && !!graded && !!given && halves);
                frames.push(target(into));
                gl.viewport(0, 0, width, height);
                gl.bindTexture(gl.TEXTURE_2D, from);
                const along = axis === 0 ? piece.across : piece.down;
                gl.uniform1i(resampler.at("axis"), axis);
                gl.uniform1i(resampler.at("curve"), FILTERS[along.filter]);
                for (const name of ["start", "step", "low", "high", "support", "scale"] as const) gl.uniform1f(resampler.at(name), along[name]);
                gradeUniforms(resampler, axis === 1 && !!graded);
                if (axis === 1 && graded) gl.uniform4f(resampler.at("toOriginal"), ...graded);
                gl.bindTexture(gl.TEXTURE_2D, from);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                return into;
            };
            const across = pass(level, piece.out.width, turned ? turned.height : part.height, 0);
            const done = pass(across, piece.out.width, piece.out.height, 1);
            const pixels = new Uint8Array(piece.out.width * piece.out.height * 4);
            gl.readPixels(0, 0, piece.out.width, piece.out.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            for (const frame of frames) gl.deleteFramebuffer(frame);
            for (const texture of new Set([input, level, across, done])) gl.deleteTexture(texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return pixels;
        },
        destroy() {
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        },
    };
}
