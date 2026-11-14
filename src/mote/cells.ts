// Mote's drawing of a grid of cells, each a whole number of pixels: a falling sand world, a game of
// life, a tile map. The cells are four bytes each, read straight from wherever they are kept (a
// WebAssembly module's memory, say) into one texture, and colored by the graphics card: the first
// byte picks a color from a palette, the second moves it lighter or darker. WebGL 2, no library.
//
//   const grid = cells(canvas);                   // undefined where WebGL 2 is missing
//   grid.palette(colors);                         // 256 colors, then 256 shade ranges (see `palette`)
//   grid.place(fitted(canvas.width, canvas.height, columns, rows));
//   grid.draw(bytes, stride, border, 0, rows - 1); // the rows that changed, then the whole grid is shown
//
// The palette also says how each kind of cell is drawn. A cell can take its color from a third row,
// picked by its second byte (stripes of a flag that a grain keeps as it falls). A cell can give light,
// as bright as its third byte says (fire, lava): the light of every such cell is gathered at half the
// grid's size, blurred across and down, and added over the grid as a soft glow around it, so that the
// cells themselves stay sharp. A cell can be soft (smoke, steam): it is drawn faint and spread a little
// into the air around it by the same blur.

/** Where a grid sits on its canvas, in the canvas's own pixels: how many pixels a side each cell is, and its top left corner. */
export interface Place {
    columns: number;
    rows: number;
    scale: number;
    left: number;
    top: number;
}

/**
 * A grid of `columns` by `rows` placed in the middle of a canvas `wide` by `high` pixels, its cells
 * as large as fit in whole pixels, and never smaller than one pixel (a grid larger than its canvas is
 * then cut at its edges).
 */
export function fitted(wide: number, high: number, columns: number, rows: number): Place {
    const scale = Math.max(1, Math.floor(Math.min(wide / columns, high / rows)));
    return { columns, rows, scale, left: Math.floor((wide - columns * scale) / 2), top: Math.floor((high - rows * scale) / 2) };
}

/**
 * The cell under a point of the canvas, given in CSS pixels with the canvas's ratio of its pixels to
 * CSS pixels; it may lie outside the grid.
 */
export function cellUnder(x: number, y: number, at: Place, ratio: number): [column: number, row: number] {
    return [Math.floor((x * ratio - at.left) / at.scale), Math.floor((y * ratio - at.top) / at.scale)];
}

/** How a kind of cell is drawn, the fourth byte of its entry in the palette's second row: its second byte picks its color from the third row. */
export const STRIPED = 1;
/** It gives light, as bright as its third byte says. */
export const LIGHT = 2;
/** It is drawn faint and spread softly into the air around it. */
export const SOFT = 4;

/**
 * The weights of a blur across `taps` texels either side of the middle, as a bell curve of spread
 * `sigma`, each pair of neighbours read as one sample between them (the graphics card blends two
 * texels for the price of one): the offsets, and the weight of each, the middle first. They add up to 1.
 */
export function blurred(taps: number, sigma: number): { offsets: number[]; weights: number[] } {
    const bell = (k: number) => Math.exp(-(k * k) / (2 * sigma * sigma));
    const raw = Array.from({ length: taps + 1 }, (_, k) => bell(k));
    const total = raw[0]! + 2 * raw.slice(1).reduce((sum, one) => sum + one, 0);
    const offsets = [0];
    const weights = [raw[0]! / total];
    for (let k = 1; k <= taps; k += 2) {
        const [a, b] = [raw[k]!, raw[k + 1] ?? 0];
        offsets.push((k * a + (k + 1) * b) / (a + b));
        weights.push((a + b) / total);
    }
    return { offsets, weights };
}

/** A grid of cells drawn on a canvas. */
export interface Cells {
    /**
     * The colors: 2048 or 3072 bytes, two or three rows of 256. The first row is a color for each
     * value of a cell's first byte, red, green, blue and opacity, for a cell of middle shade; the
     * second is how far the second byte, from 0 to 255, moves red, green and blue, from darker to
     * lighter, and how it is drawn (`STRIPED`, `LIGHT`, `SOFT`, added together). The third row is
     * the colors a striped cell picks from: its second byte over 4 is which, and its lowest two bits
     * a slight shade.
     */
    palette(colors: Uint8Array): void;
    /** Where the grid is drawn. A new size makes a new texture, so the next `draw` should send every row. */
    place(at: Place): void;
    /**
     * Sends rows `from` to `to` (both counted; none when `to` is less than `from`) of the cells to the
     * graphics card, and shows the whole grid. `bytes` holds `stride` cells to a row, the grid starting
     * `border` cells in from the left and from the top, as a grid with a frame around it is kept. When
     * nothing is sent and nothing else changed, the canvas is left as it is.
     */
    draw(bytes: Uint8Array, stride: number, border: number, from: number, to: number): void;
    /** Lets go of what is held on the graphics card. */
    dispose(): void;
}

const VERTEX = `#version 300 es
void main() {
    // one triangle that covers the whole of the viewport
    vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

/** The color of a cell, as the first and second rows of the palette and, for a striped one, the third say. */
const COLOR = `
uniform usampler2D cells;
uniform sampler2D colors;
vec4 colorOf(uvec4 cell, out uint mode) {
    vec4 base = texelFetch(colors, ivec2(int(cell.r), 0), 0);
    vec4 vary = texelFetch(colors, ivec2(int(cell.r), 1), 0);
    mode = uint(vary.a * 255.0 + 0.5);
    vec3 rgb;
    if ((mode & 1u) != 0u) {
        rgb = texelFetch(colors, ivec2(int(cell.g >> 2), 2), 0).rgb + (float(cell.g & 3u) / 3.0 - 0.5) * vary.rgb;
    } else {
        rgb = base.rgb + (float(cell.g) / 255.0 - 0.5) * vary.rgb;
    }
    return vec4(clamp(rgb, 0.0, 1.0), base.a);
}`;

/** Gathers the light and the soft cells of each two by two cells into one texel of each of two pictures half the grid's size. */
const GATHER = `#version 300 es
precision highp float;
precision highp usampler2D;
${COLOR}
uniform ivec2 size;
layout(location = 0) out vec4 light;
layout(location = 1) out vec4 soft;
void main() {
    ivec2 low = ivec2(gl_FragCoord.xy);
    vec3 shine = vec3(0.0);
    vec4 haze = vec4(0.0);
    for (int dy = 0; dy < 2; dy++) {
        for (int dx = 0; dx < 2; dx++) {
            // counted up from the bottom here, and from the top in the cells
            ivec2 up = low * 2 + ivec2(dx, dy);
            if (up.x >= size.x || up.y >= size.y) continue;
            uvec4 cell = texelFetch(cells, ivec2(up.x, size.y - 1 - up.y), 0);
            uint mode;
            vec4 color = colorOf(cell, mode);
            if ((mode & 2u) != 0u) {
                float t = clamp((float(cell.b) - 70.0) / 170.0, 0.0, 1.0);
                float eased = t * t * (3.0 - 2.0 * t);
                shine += color.rgb * eased * eased;
            }
            if ((mode & 4u) != 0u) haze += vec4(color.rgb * color.a, color.a);
        }
    }
    light = vec4(shine * 0.25, 1.0);
    soft = haze * 0.25;
}`;

/** Blurs both half-sized pictures one way, across or down, by the weights of `blurred`. */
const BLUR = (taps: number) => `#version 300 es
precision highp float;
uniform sampler2D light;
uniform sampler2D soft;
uniform vec2 step;
uniform float offsets[${taps}];
uniform float weights[${taps}];
layout(location = 0) out vec4 lightOut;
layout(location = 1) out vec4 softOut;
void main() {
    vec2 texel = 1.0 / vec2(textureSize(light, 0));
    vec2 uv = gl_FragCoord.xy * texel;
    vec2 way = step * texel;
    vec4 l = texture(light, uv) * weights[0];
    vec4 s = texture(soft, uv) * weights[0];
    for (int k = 1; k < ${taps}; k++) {
        vec2 off = way * offsets[k];
        l += (texture(light, uv + off) + texture(light, uv - off)) * weights[k];
        s += (texture(soft, uv + off) + texture(soft, uv - off)) * weights[k];
    }
    lightOut = l;
    softOut = s;
}`;

/** Draws the cells sharp, a soft cell faint over the blurred haze, and the blurred light added over it all. */
const FRAGMENT = `#version 300 es
precision highp float;
precision highp usampler2D;
${COLOR}
uniform sampler2D light;
uniform sampler2D soft;
uniform vec2 origin;
uniform float scale;
uniform int rows;
uniform vec2 grid;
uniform float glow;
out vec4 color;
void main() {
    vec2 inside = (gl_FragCoord.xy - origin) / scale;
    ivec2 at = ivec2(inside);
    at.y = rows - 1 - at.y;
    uint mode;
    vec4 cell = colorOf(texelFetch(cells, at, 0), mode);
    vec4 sharp = vec4(cell.rgb * cell.a, cell.a);
    // a soft cell is only faint itself: most of it is in the haze around it
    if ((mode & 4u) != 0u) sharp *= 0.4;
    vec2 uv = inside / grid;
    vec4 haze = texture(soft, uv);
    vec4 out4 = sharp + haze * (1.0 - sharp.a);
    out4.rgb = min(out4.rgb + texture(light, uv).rgb * glow, 1.0);
    // light over empty cells is kept a color the page can blend: as opaque as it is bright
    out4.a = max(out4.a, max(out4.r, max(out4.g, out4.b)));
    color = out4;
}`;

/** How many samples the blur takes each way, the middle one counted: 1 and 3 pairs of texels, each pair read as one. */
const TAPS = 4;

/** A grid of cells on `canvas`, or undefined where the browser has no WebGL 2. */
export function cells(canvas: HTMLCanvasElement): Cells | undefined {
    const g = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true });
    if (!g) return undefined;
    const shader = (kind: number, source: string) => {
        const made = g.createShader(kind)!;
        g.shaderSource(made, source);
        g.compileShader(made);
        if (!g.getShaderParameter(made, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(made) ?? "a shader did not compile");
        return made;
    };
    const vertex = shader(g.VERTEX_SHADER, VERTEX);
    const program = (fragment: string) => {
        const made = g.createProgram();
        g.attachShader(made, vertex);
        g.attachShader(made, shader(g.FRAGMENT_SHADER, fragment));
        g.linkProgram(made);
        if (!g.getProgramParameter(made, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(made) ?? "the shaders did not link");
        const where = new Map<string, WebGLUniformLocation | null>();
        return { made, at: (name: string) => (where.has(name) ? where.get(name)! : where.set(name, g.getUniformLocation(made, name)).get(name)!) };
    };
    const drawn = program(FRAGMENT);
    const gather = program(GATHER);
    const blur = program(BLUR(TAPS));
    const { offsets, weights } = blurred(2 * (TAPS - 1), 2.6);
    const empty = g.createVertexArray();

    const texture = (unit: number, smooth = false) => {
        const made = g.createTexture();
        g.activeTexture(g.TEXTURE0 + unit);
        g.bindTexture(g.TEXTURE_2D, made);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, smooth ? g.LINEAR : g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, smooth ? g.LINEAR : g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        return made;
    };
    const colors = texture(1);
    g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8, 256, 3);
    let grid: WebGLTexture | undefined;
    let at: Place = { columns: 0, rows: 0, scale: 1, left: 0, top: 0 };
    /** Whether any kind of cell gives light or is soft, so that the half-sized pictures are worth making. */
    let effects = false;
    /** Something besides the cells changed since the canvas was last drawn. */
    let stale = true;

    /** Two pairs of half-sized pictures, light and haze, the blur going from one pair to the other and back. */
    interface Pair {
        light: WebGLTexture;
        soft: WebGLTexture;
        frame: WebGLFramebuffer;
    }
    let pairs: [Pair, Pair] | undefined;
    const half = () => [Math.max(1, Math.ceil(at.columns / 2)), Math.max(1, Math.ceil(at.rows / 2))] as const;
    const makePairs = () => {
        for (const pair of pairs ?? []) {
            g.deleteTexture(pair.light);
            g.deleteTexture(pair.soft);
            g.deleteFramebuffer(pair.frame);
        }
        const [wide, high] = half();
        const one = (): Pair => {
            const light = texture(2, true);
            g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8, wide, high);
            const soft = texture(2, true);
            g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8, wide, high);
            const frame = g.createFramebuffer();
            g.bindFramebuffer(g.FRAMEBUFFER, frame);
            g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, light, 0);
            g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT1, g.TEXTURE_2D, soft, 0);
            g.drawBuffers([g.COLOR_ATTACHMENT0, g.COLOR_ATTACHMENT1]);
            g.bindFramebuffer(g.FRAMEBUFFER, null);
            return { light, soft, frame };
        };
        pairs = [one(), one()];
    };
    const bind = (unit: number, made: WebGLTexture) => {
        g.activeTexture(g.TEXTURE0 + unit);
        g.bindTexture(g.TEXTURE_2D, made);
    };

    return {
        palette(bytes) {
            g.activeTexture(g.TEXTURE1);
            g.bindTexture(g.TEXTURE_2D, colors);
            g.pixelStorei(g.UNPACK_ROW_LENGTH, 0);
            g.pixelStorei(g.UNPACK_SKIP_PIXELS, 0);
            g.pixelStorei(g.UNPACK_SKIP_ROWS, 0);
            g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 256, Math.min(3, Math.floor(bytes.length / 1024)), g.RGBA, g.UNSIGNED_BYTE, bytes);
            effects = false;
            for (let k = 0; k < 256; k++) effects ||= (bytes[1024 + k * 4 + 3]! & (LIGHT | SOFT)) !== 0;
            stale = true;
        },
        place(next) {
            const resized = !grid || next.columns !== at.columns || next.rows !== at.rows;
            at = next;
            if (resized) {
                if (grid) g.deleteTexture(grid);
                grid = texture(0);
                g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8UI, next.columns, next.rows);
                makePairs();
            }
            stale = true;
        },
        draw(bytes, stride, border, from, to) {
            if (!grid || !pairs) return;
            from = Math.max(0, from);
            to = Math.min(at.rows - 1, to);
            if (to < from && !stale) return;
            stale = false;
            if (to >= from) {
                // read straight out of `bytes`, a row at a time with its frame stepped over
                g.activeTexture(g.TEXTURE0);
                g.bindTexture(g.TEXTURE_2D, grid);
                g.pixelStorei(g.UNPACK_ALIGNMENT, 4);
                g.pixelStorei(g.UNPACK_ROW_LENGTH, stride);
                g.pixelStorei(g.UNPACK_SKIP_PIXELS, border);
                g.pixelStorei(g.UNPACK_SKIP_ROWS, border + from);
                g.texSubImage2D(g.TEXTURE_2D, 0, 0, from, at.columns, to - from + 1, g.RGBA_INTEGER, g.UNSIGNED_BYTE, bytes);
            }
            g.bindVertexArray(empty);
            bind(0, grid);
            bind(1, colors);
            const [wide, high] = half();
            if (effects) {
                // the light and the haze, gathered at half size, then blurred across and down
                g.viewport(0, 0, wide, high);
                g.bindFramebuffer(g.FRAMEBUFFER, pairs[0].frame);
                g.useProgram(gather.made);
                g.uniform1i(gather.at("cells"), 0);
                g.uniform1i(gather.at("colors"), 1);
                g.uniform2i(gather.at("size"), at.columns, at.rows);
                g.drawArrays(g.TRIANGLES, 0, 3);
                g.useProgram(blur.made);
                g.uniform1i(blur.at("light"), 2);
                g.uniform1i(blur.at("soft"), 3);
                g.uniform1fv(blur.at("offsets"), offsets);
                g.uniform1fv(blur.at("weights"), weights);
                for (const [source, target, way] of [[pairs[0], pairs[1], [1, 0]], [pairs[1], pairs[0], [0, 1]]] as const) {
                    g.bindFramebuffer(g.FRAMEBUFFER, target.frame);
                    bind(2, source.light);
                    bind(3, source.soft);
                    g.uniform2f(blur.at("step"), way[0], way[1]);
                    g.drawArrays(g.TRIANGLES, 0, 3);
                }
                g.bindFramebuffer(g.FRAMEBUFFER, null);
            }
            g.viewport(0, 0, canvas.width, canvas.height);
            g.clearColor(0, 0, 0, 0);
            g.clear(g.COLOR_BUFFER_BIT);
            const bottom = canvas.height - at.top - at.rows * at.scale;
            g.viewport(at.left, bottom, at.columns * at.scale, at.rows * at.scale);
            g.useProgram(drawn.made);
            g.uniform1i(drawn.at("cells"), 0);
            g.uniform1i(drawn.at("colors"), 1);
            g.uniform1i(drawn.at("light"), 2);
            g.uniform1i(drawn.at("soft"), 3);
            g.uniform2f(drawn.at("origin"), at.left, bottom);
            g.uniform1f(drawn.at("scale"), at.scale);
            g.uniform1i(drawn.at("rows"), at.rows);
            // the half-sized pictures cover a whole number of texels, a cell more than the grid when it is odd
            g.uniform2f(drawn.at("grid"), wide * 2, high * 2);
            g.uniform1f(drawn.at("glow"), effects ? 1 : 0);
            bind(0, grid);
            bind(1, colors);
            bind(2, pairs[0].light);
            bind(3, pairs[0].soft);
            g.drawArrays(g.TRIANGLES, 0, 3);
        },
        dispose() {
            if (grid) g.deleteTexture(grid);
            for (const pair of pairs ?? []) {
                g.deleteTexture(pair.light);
                g.deleteTexture(pair.soft);
                g.deleteFramebuffer(pair.frame);
            }
            g.deleteTexture(colors);
            for (const one of [drawn, gather, blur]) g.deleteProgram(one.made);
            g.deleteVertexArray(empty);
        },
    };
}
