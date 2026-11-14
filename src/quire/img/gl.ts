// The picture drawn through WebGL2, for browsers without WebGPU (gpu.ts is the other way, and
// draw.ts says what the two share). Two small programs: one draws images and solid rectangles on
// the screen, the other resamples a piece of the picture along one axis by the resize's filter.

import type { Backend, Color, Drawn, Piece, Texture } from "./draw";
import type { Rect } from "./steps";

const SCREEN = `#version 300 es
in vec2 corner;
uniform vec4 to;
uniform vec2 canvas;
out vec2 place;
void main() {
    place = corner;
    vec2 at = to.xy + corner * to.zw;
    gl_Position = vec4(at.x / canvas.x * 2.0 - 1.0, 1.0 - at.y / canvas.y * 2.0, 0.0, 1.0);
}`;

const PAINT = `#version 300 es
precision highp float;
in vec2 place;
uniform sampler2D image;
uniform vec4 fill;
out vec4 color;
void main() {
    vec4 found = fill.a >= 0.0 ? fill : texture(image, place);
    color = vec4(found.rgb * found.a, found.a);
}`;

const WHOLE = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0); }`;

// one pass of resampling: each pixel of the result is the filter's weighted sum of the samples of
// the input along one axis, read only between low and high, so that nothing past the crop is read
const RESAMPLE = `#version 300 es
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
out vec4 color;
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
void main() {
    ivec2 at = ivec2(gl_FragCoord.xy);
    float center = start + float(axis == 0 ? at.x : at.y) * step;
    // nearest: a sample exactly half way between two pixels falls the same way in every implementation
    if (curve == 2) { color = read(floor(center + 0.501), at); return; }
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
    const screen = program(SCREEN, PAINT);
    const resampler = program(WHOLE, RESAMPLE);
    // one square, two triangles, from 0 to 1, for every draw
    const square = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, square);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const textures = new WeakMap<Texture, WebGLTexture>();

    const store = (width: number, height: number, image?: ImageBitmap, small = false): WebGLTexture => {
        const texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        if (image) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
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
        draw(images: Drawn[], fills: { rect: Rect; color: Color }[], clip?: Rect) {
            const { width, height } = canvas;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, width, height);
            gl.disable(gl.SCISSOR_TEST);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(screen.made);
            gl.uniform2f(screen.at("canvas"), width, height);
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
                gl.uniform4f(screen.at("fill"), 0, 0, 0, -1);
                gl.uniform4f(screen.at("to"), image.to.x, image.to.y, image.to.width, image.to.height);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
            for (const fill of fills) {
                gl.uniform4f(screen.at("fill"), ...fill.color);
                gl.uniform4f(screen.at("to"), fill.rect.x, fill.rect.y, fill.rect.width, fill.rect.height);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
            gl.disable(gl.SCISSOR_TEST);
            gl.disable(gl.BLEND);
        },
        async resample(part, covers, piece: Piece) {
            const input = store(part.width, part.height, part);
            const frames: WebGLFramebuffer[] = [target(input)];
            // the covers painted straight into the piece read, so that what they hide is gone before any of it is sampled
            gl.enable(gl.SCISSOR_TEST);
            for (const cover of covers) {
                scissor(cover.rect, part.height, false);
                gl.clearColor(...cover.color);
                gl.clear(gl.COLOR_BUFFER_BIT);
            }
            gl.disable(gl.SCISSOR_TEST);
            gl.disable(gl.BLEND);
            gl.useProgram(resampler.made);
            gl.uniform1i(resampler.at("source"), 0);
            gl.activeTexture(gl.TEXTURE0);
            const pass = (from: WebGLTexture, width: number, height: number, axis: 0 | 1) => {
                const into = store(width, height);
                frames.push(target(into));
                gl.viewport(0, 0, width, height);
                gl.bindTexture(gl.TEXTURE_2D, from);
                const along = axis === 0 ? piece.across : piece.down;
                gl.uniform1i(resampler.at("axis"), axis);
                gl.uniform1i(resampler.at("curve"), FILTERS[along.filter]);
                for (const name of ["start", "step", "low", "high", "support", "scale"] as const) gl.uniform1f(resampler.at(name), along[name]);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                return into;
            };
            const across = pass(input, piece.out.width, part.height, 0);
            const done = pass(across, piece.out.width, piece.out.height, 1);
            const pixels = new Uint8Array(piece.out.width * piece.out.height * 4);
            gl.readPixels(0, 0, piece.out.width, piece.out.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            for (const frame of frames) gl.deleteFramebuffer(frame);
            for (const texture of [input, across, done]) gl.deleteTexture(texture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return pixels;
        },
        destroy() {
            gl.getExtension("WEBGL_lose_context")?.loseContext();
        },
    };
}
