// The picture drawn through WebGPU, the first choice where the browser has it (gl.ts is the other
// way, and draw.ts says what the two share). The same two jobs as WebGL2's, in WGSL: images and solid
// rectangles on the screen, and resampling a piece along one axis by the resize's filter. WebGPU makes
// no smaller copies of a texture by itself, so they are drawn here, each from the one before. Both
// grade as they go when given a grade (grade-shader.ts), from storage buffers in group 1.

import type { Backend, Color, Drawn, Grading, Piece, ScreenGrade, Texture } from "./draw";
import type { Rect } from "./steps";
import { GRADE_WGSL } from "./grade-shader";

// with no grade the programs are built with a `graded` that gives the color back, so that drawing without one costs what it did
const UNGRADED = "fn graded(c: vec3f, place: vec2f) -> vec3f { return c; }";

const SCREEN = (grading: boolean) => /* wgsl */ `
struct Draw { to: vec4f, canvas: vec2f, fill: vec4f, toOriginal: vec4f, grade: f32, split: f32 };
@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var image: texture_2d<f32>;
@group(0) @binding(2) var soft: sampler;
struct Out { @builtin(position) at: vec4f, @location(0) place: vec2f };
@vertex fn vertex(@builtin(vertex_index) index: u32) -> Out {
    let corners = array(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
    let corner = corners[index];
    let at = draw.to.xy + corner * draw.to.zw;
    return Out(vec4f(at.x / draw.canvas.x * 2 - 1, 1 - at.y / draw.canvas.y * 2, 0, 1), corner);
}
${grading ? GRADE_WGSL : UNGRADED}
@fragment fn fragment(in: Out) -> @location(0) vec4f {
    var found = select(textureSample(image, soft, in.place), draw.fill, draw.fill.a >= 0);
    if (draw.grade == 1.0 && in.at.x >= draw.split) { found = vec4f(graded(clamp(found.rgb, vec3f(0.0), vec3f(1.0)), draw.toOriginal.xy + in.at.xy * draw.toOriginal.zw), found.a); }
    return vec4f(found.rgb * found.a, found.a);
}`;

// one pass of resampling, as gl.ts's: the filter's weighted sum along one axis, read only between low and high
const RESAMPLE = (grading: boolean) => /* wgsl */ `
struct Job { axis: i32, curve: i32, start: f32, step: f32, low: f32, high: f32, support: f32, scale: f32, toOriginal: vec4f, grade: i32 };
@group(0) @binding(0) var<uniform> job: Job;
@group(0) @binding(1) var source: texture_2d<f32>;
@vertex fn vertex(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let corners = array(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(-1, 1), vec2f(1, -1), vec2f(1, 1));
    return vec4f(corners[index], 0, 1);
}
fn weight(given: f32) -> f32 {
    let x = abs(given);
    if (job.curve == 1) { return max(0.0, 1.0 - x); }
    if (x < 1e-5) { return 1.0; }
    if (x >= 3.0) { return 0.0; }
    let p = 3.14159265358979 * x;
    return 3.0 * sin(p) * sin(p / 3.0) / (p * p);
}
fn sampleAt(t: f32, at: vec2i) -> vec4f {
    let i = i32(clamp(t, job.low, job.high));
    if (job.axis == 0) { return textureLoad(source, vec2i(i, at.y), 0); }
    return textureLoad(source, vec2i(at.x, i), 0);
}
fn sampled(at: vec2i) -> vec4f {
    let center = job.start + f32(select(at.y, at.x, job.axis == 0)) * job.step;
    // nearest: a sample exactly half way between two pixels falls the same way in every implementation
    if (job.curve == 2) { return sampleAt(floor(center + 0.501), at); }
    var sum = vec4f(0);
    var total = 0.0;
    let first = ceil(center - job.support);
    for (var i = 0; i < 4096; i++) {
        let t = first + f32(i);
        if (t > center + job.support) { break; }
        let w = weight((t - center) * job.scale);
        sum += w * sampleAt(t, at);
        total += w;
    }
    return sum / total;
}
${grading ? GRADE_WGSL : UNGRADED}
@fragment fn fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let at = vec2i(floor(position.xy));
    let color = sampled(at);
    // the pass down grades the pixel it makes, before it is rounded
    if (job.grade == 1) { return vec4f(graded(clamp(color.rgb, vec3f(0.0), vec3f(1.0)), job.toOriginal.xy + (vec2f(at) + 0.5) * job.toOriginal.zw), color.a); }
    return color;
}`;

// a level of smaller copy drawn from the one before it
const HALVE = /* wgsl */ `
@group(0) @binding(0) var before: texture_2d<f32>;
@group(0) @binding(1) var soft: sampler;
struct Out { @builtin(position) at: vec4f, @location(0) place: vec2f };
@vertex fn vertex(@builtin(vertex_index) index: u32) -> Out {
    let corners = array(vec2f(0, 0), vec2f(1, 0), vec2f(0, 1), vec2f(0, 1), vec2f(1, 0), vec2f(1, 1));
    let corner = corners[index];
    return Out(vec4f(corner.x * 2 - 1, 1 - corner.y * 2, 0, 1), corner);
}
@fragment fn fragment(in: Out) -> @location(0) vec4f { return textureSample(before, soft, in.place); }`;

const FILTERS = { lanczos: 0, bilinear: 1, nearest: 2 } as const;
/** WebGPU's flags by their numbers in the standard, which TypeScript's library here does not name. */
const TEXTURE = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, RENDER_ATTACHMENT: 16 };
const BUFFER = { MAP_READ: 1, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const READ = 1;
/** Room for one draw's numbers in the uniform buffer, as WebGPU wants them spaced. */
const SLOT = 256;

/** WebGPU on a canvas, or undefined where the browser has none or the card says no. */
export async function webgpu(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Backend | undefined> {
    const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
    const adapter = await gpu?.requestAdapter().catch(() => null);
    if (!gpu || !adapter) return undefined;
    const device = await adapter.requestDevice().catch(() => undefined);
    if (!device) return undefined;
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) return undefined;
    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    const blend: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } };
    const pipeline = (code: string, into: GPUTextureFormat, blended: boolean) => {
        const module = device.createShaderModule({ code });
        return device.createRenderPipeline({ layout: "auto", vertex: { module, entryPoint: "vertex" }, fragment: { module, entryPoint: "fragment", targets: [{ format: into, ...(blended ? { blend } : {}) }] }, primitive: { topology: "triangle-list" } });
    };
    const screen = pipeline(SCREEN(false), format, true);
    const screenGraded = pipeline(SCREEN(true), format, true);
    const fillInto = pipeline(SCREEN(false), "rgba8unorm", false);
    const resampler = pipeline(RESAMPLE(false), "rgba8unorm", false);
    const resamplerGraded = pipeline(RESAMPLE(true), "rgba8unorm", false);
    // the pass across into half floats, for a graded picture, so that it is never held in 8 bits between the passes
    const resamplerHalf = pipeline(RESAMPLE(false), "rgba16float", false);
    const halver = pipeline(HALVE, "rgba8unorm", false);
    const sharp = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
    const smooth = device.createSampler({ magFilter: "linear", minFilter: "linear", mipmapFilter: "linear" });
    const textures = new WeakMap<Texture, GPUTexture>();
    const blank = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage: TEXTURE.TEXTURE_BINDING });
    let numbers = device.createBuffer({ size: SLOT * 64, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
    // the grade's three buffers, given when the grade changes: its few numbers, the packed grades and the masks
    const gradeHead = device.createBuffer({ size: 96, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
    let gradeData = device.createBuffer({ size: 16, usage: BUFFER.STORAGE | BUFFER.COPY_DST });
    let gradeMasks = device.createBuffer({ size: 16, usage: BUFFER.STORAGE | BUFFER.COPY_DST });
    let given: Grading | undefined;
    let masksGiven: Grading["masks"] | null = null;
    const groups = new Map<GPURenderPipeline, GPUBindGroup>();
    /** The grade's bind group for a pipeline, made again when a buffer was made anew. */
    const gradeGroup = (pipeline: GPURenderPipeline) => {
        let found = groups.get(pipeline);
        if (!found) groups.set(pipeline, (found = device.createBindGroup({ layout: pipeline.getBindGroupLayout(1), entries: [{ binding: 0, resource: { buffer: gradeHead } }, { binding: 1, resource: { buffer: gradeData } }, { binding: 2, resource: { buffer: gradeMasks } }] })));
        return found;
    };

    /** Writes each draw's numbers into its own slot, making the buffer larger when a draw has more. */
    const slots = (rows: number[][]) => {
        if (rows.length * SLOT > numbers.size) {
            numbers.destroy();
            numbers = device.createBuffer({ size: SLOT * Math.max(64, rows.length * 2), usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
        }
        const all = new ArrayBuffer(rows.length * SLOT);
        rows.forEach((row, at) => new Float32Array(all, at * SLOT, row.length).set(row));
        device.queue.writeBuffer(numbers, 0, all);
    };
    const made = (width: number, height: number, levels = 1, half = false) =>
        device.createTexture({ size: [width, height], format: half ? "rgba16float" : "rgba8unorm", mipLevelCount: levels, usage: TEXTURE.TEXTURE_BINDING | TEXTURE.COPY_DST | TEXTURE.COPY_SRC | TEXTURE.RENDER_ATTACHMENT });
    const upload = (image: ImageBitmap, levels = 1) => {
        const texture = made(image.width, image.height, levels);
        device.queue.copyExternalImageToTexture({ source: image }, { texture, premultipliedAlpha: false }, [image.width, image.height]);
        return texture;
    };
    const halve = (texture: GPUTexture) => {
        const encoder = device.createCommandEncoder();
        for (let level = 1; level < texture.mipLevelCount; level++) {
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }), loadOp: "clear", storeOp: "store" }] });
            pass.setPipeline(halver);
            pass.setBindGroup(0, device.createBindGroup({ layout: halver.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) }, { binding: 1, resource: smooth }] }));
            pass.draw(6);
            pass.end();
        }
        device.queue.submit([encoder.finish()]);
    };
    // the draws of one pass on the screen or into a texture: images and fills, each with its slot of numbers
    const paint = (pass: GPURenderPassEncoder, into: GPURenderPipeline, list: { texture?: GPUTexture; sharp?: boolean }[], from: number) =>
        list.forEach((each, at) => {
            pass.setBindGroup(0, device.createBindGroup({ layout: into.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: numbers, offset: (from + at) * SLOT, size: 80 } }, { binding: 1, resource: (each.texture ?? blank).createView() }, { binding: 2, resource: each.sharp ? sharp : smooth }] }));
            pass.draw(6);
        });
    const scissor = (pass: GPURenderPassEncoder, rect: Rect, width: number, height: number) => {
        const x = Math.min(width, Math.max(0, Math.floor(rect.x)));
        const y = Math.min(height, Math.max(0, Math.floor(rect.y)));
        pass.setScissorRect(x, y, Math.max(0, Math.min(width, Math.ceil(rect.x + rect.width)) - x), Math.max(0, Math.min(height, Math.ceil(rect.y + rect.height)) - y));
    };

    return {
        name: "WebGPU",
        lost: device.lost.then(() => undefined),
        most: device.limits.maxTextureDimension2D,
        texture(image) {
            const shown = { width: image.width, height: image.height };
            const texture = upload(image, Math.floor(Math.log2(Math.max(image.width, image.height))) + 1);
            halve(texture);
            textures.set(shown, texture);
            return shown;
        },
        free(texture) {
            textures.get(texture)?.destroy();
            textures.delete(texture);
        },
        grading(next) {
            if (next === given) return;
            given = next;
            if (!next) return;
            const head = new ArrayBuffer(96);
            const floats = new Float32Array(head);
            const { luma, back } = next.numbers;
            floats.set([luma[0], luma[1], luma[2], 0, back[0]!, back[1]!, back[2]!, 0, back[3]!, back[4]!, back[5]!, 0, back[6]!, back[7]!, back[8]!, 0, next.masks?.width ?? 1, next.masks?.height ?? 1, next.picture.width, next.picture.height]);
            new Int32Array(head, 80, 2).set([next.packed.count, next.masks?.layers.length ?? 0]);
            device.queue.writeBuffer(gradeHead, 0, head);
            if (next.packed.data.byteLength > gradeData.size) {
                gradeData.destroy();
                gradeData = device.createBuffer({ size: next.packed.data.byteLength, usage: BUFFER.STORAGE | BUFFER.COPY_DST });
                groups.clear();
            }
            device.queue.writeBuffer(gradeData, 0, next.packed.data);
            if (next.masks !== masksGiven) {
                masksGiven = next.masks;
                const masks = next.masks;
                const bytes = masks ? masks.width * masks.height * masks.layers.length * 4 : 0;
                if (bytes > gradeMasks.size) {
                    gradeMasks.destroy();
                    gradeMasks = device.createBuffer({ size: bytes, usage: BUFFER.STORAGE | BUFFER.COPY_DST });
                    groups.clear();
                }
                masks?.layers.forEach((layer, at) => device.queue.writeBuffer(gradeMasks, at * masks.width * masks.height * 4, layer));
            }
        },
        draw(images: Drawn[], fills: { rect: Rect; color: Color; graded?: boolean }[], clip?: Rect, graded?: ScreenGrade) {
            const { width, height } = canvas;
            const drawn = images.filter((image) => textures.has(image.texture));
            const on = graded && given ? 1 : 0;
            const tail = (grade: number) => [...(graded?.toOriginal ?? [0, 0, 1, 1]), grade, graded?.split ?? -1, 0, 0];
            const rows = [...drawn.map((image) => [image.to.x, image.to.y, image.to.width, image.to.height, width, height, 0, 0, 0, 0, 0, -1, ...tail(on)]), ...fills.map((fill) => [fill.rect.x, fill.rect.y, fill.rect.width, fill.rect.height, width, height, 0, 0, ...fill.color, ...tail(on && fill.graded ? 1 : 0)])];
            slots(rows);
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }] });
            const using = on ? screenGraded : screen;
            pass.setPipeline(using);
            if (on) pass.setBindGroup(1, gradeGroup(using));
            if (clip) scissor(pass, clip, width, height);
            paint(pass, using, drawn.map((image) => ({ texture: textures.get(image.texture), sharp: image.sharp })), 0);
            paint(pass, using, fills.map(() => ({})), drawn.length);
            pass.end();
            device.queue.submit([encoder.finish()]);
        },
        async resample(part, covers, piece: Piece, graded?: [number, number, number, number]) {
            const input = upload(part);
            const half = !!graded && !!given;
            const across = made(piece.out.width, part.height, 1, half);
            const done = made(piece.out.width, piece.out.height);
            const job = (axis: 0 | 1) => {
                const along = axis === 0 ? piece.across : piece.down;
                const row = new ArrayBuffer(64);
                new Int32Array(row, 0, 2).set([axis, FILTERS[along.filter]]);
                new Float32Array(row, 8, 6).set([along.start, along.step, along.low, along.high, along.support, along.scale]);
                new Float32Array(row, 32, 4).set(graded ?? [0, 0, 1, 1]);
                new Int32Array(row, 48, 1).set([axis === 1 && graded && given ? 1 : 0]);
                return row;
            };
            // the covers' numbers first, then the two passes', each in its own slot
            slots(covers.map((cover) => [0, 0, part.width, part.height, part.width, part.height, 0, 0, ...cover.color, 0, 0, 1, 1, 0, -1, 0, 0]));
            const passes = device.createBuffer({ size: SLOT * 2, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
            device.queue.writeBuffer(passes, 0, job(0));
            device.queue.writeBuffer(passes, SLOT, job(1));
            const encoder = device.createCommandEncoder();
            if (covers.length) {
                // the covers painted straight into the piece read, so that what they hide is gone before any of it is sampled
                const pass = encoder.beginRenderPass({ colorAttachments: [{ view: input.createView(), loadOp: "load", storeOp: "store" }] });
                pass.setPipeline(fillInto);
                covers.forEach((cover, at) => {
                    scissor(pass, cover.rect, part.width, part.height);
                    paint(pass, fillInto, [{}], at);
                });
                pass.end();
            }
            for (const [axis, from, into] of [[0, input, across], [1, across, done]] as const) {
                const pass = encoder.beginRenderPass({ colorAttachments: [{ view: into.createView(), loadOp: "clear", storeOp: "store" }] });
                const using = axis === 0 ? (half ? resamplerHalf : resampler) : half ? resamplerGraded : resampler;
                pass.setPipeline(using);
                pass.setBindGroup(0, device.createBindGroup({ layout: using.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: passes, offset: axis * SLOT, size: 64 } }, { binding: 1, resource: from.createView() }] }));
                if (using === resamplerGraded) pass.setBindGroup(1, gradeGroup(using));
                pass.draw(6);
                pass.end();
            }
            const row = Math.ceil((piece.out.width * 4) / 256) * 256;
            const read = device.createBuffer({ size: row * piece.out.height, usage: BUFFER.COPY_DST | BUFFER.MAP_READ });
            encoder.copyTextureToBuffer({ texture: done }, { buffer: read, bytesPerRow: row }, [piece.out.width, piece.out.height]);
            device.queue.submit([encoder.finish()]);
            await read.mapAsync(READ);
            const padded = new Uint8Array(read.getMappedRange());
            const pixels = new Uint8Array(piece.out.width * piece.out.height * 4);
            for (let y = 0; y < piece.out.height; y++) pixels.set(padded.subarray(y * row, y * row + piece.out.width * 4), y * piece.out.width * 4);
            read.unmap();
            for (const each of [input, across, done, read, passes]) each.destroy();
            return pixels;
        },
        destroy() {
            device.destroy();
        },
    };
}
