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
// cells themselves stay sharp; blurred once more at an eighth of the grid's size, it is added again as
// a wide, faint halo, the light a fire throws on what is round it. A cell can be soft (smoke, steam, a
// flame): it is drawn faint and spread a little into the air around it by the same blur, so that cells
// of it near each other read as one body. A cell can be deep (water: lighter at its surface, darker
// below), and can be spray: paler the faster it is falling, by the speed in its fourth byte's high half, where it has
// air beside it.

/**
 * Where a grid sits on its canvas, in the canvas's own pixels: how many pixels a side each cell is, and
 * its top left corner. A grid larger than its canvas is a view onto part of it: its corner then lies
 * up and left of the canvas's, and `scale` may be any size, less than one pixel a cell when the view
 * is far out, where the cells a pixel covers are drawn together.
 */
export interface Place {
    columns: number;
    rows: number;
    scale: number;
    left: number;
    top: number;
    /**
     * How many quarter turns the cells as they are kept lie from the grid as it is seen, 0 to 3: the
     * cell seen at column x, row y is kept at (y, columns - 1 - x) for one turn (`keptCell`), and the
     * grid kept is then as wide as the one seen is high. For a grid whose keeper turns it, as a world
     * of sand is turned to turn its gravity, and which is to be seen as it was.
     */
    turn?: number;
}

/** Where the cell seen at column `x`, row `y` of a grid `columns` by `rows` is kept, for `turn` quarter turns. */
export function keptCell([x, y]: [number, number], turn: number, columns: number, rows: number): [x: number, y: number] {
    if (turn === 1) return [y, columns - 1 - x];
    if (turn === 2) return [columns - 1 - x, rows - 1 - y];
    if (turn === 3) return [rows - 1 - y, x];
    return [x, y];
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

/** It is drawn with depth: lighter in its top cell, darker the deeper below its surface. */
export const DEEP = 8;
/** It is drawn paler the faster it is falling, where it is loose (not its own kind on every side): the high half of its fourth byte is its speed. */
export const SPRAY = 16;

/** The speed at which spray is as pale as it gets, and how far toward white that is. */
const FOAM = { speed: 9, pale: 0.55 };

/** How many cells below its surface a deep cell darkens through, and how much lighter its top cell is drawn. */
const DEPTH = { cells: 12, top: 1.3, step: 0.03 };

/** How much more strongly light shows in empty air than on a grain: the glow round flames and lava. */
export const GLOW_AIR = 1.2;

/** How strongly the wide halo is added, and how many times smaller than the near glow's picture its picture is each way. */
export const HALO = { strength: 2.2, smaller: 4 };

/** How many cells past what the canvas shows the light and haze are worked out, as far as the halo reaches. */
const REACH = 96;

/**
 * A fire is drawn as one body, not flame by flame. Its flames are gathered, by how hot each is, into a
 * field blurred with the light, and the field is colored by how strong it is at each place: deep red at
 * its fringe, through orange and gold, to near white at its heart. `gathered` and `gain` are how much a
 * flame counts for where it is gathered and where it is drawn; `from` and `full` the strengths between
 * which the body comes in; `sharp` how strongly a flame's own cell is still drawn
 * (a fleck in the body); and `over` how much of the body shows over a grain, so that burning wood is seen
 * through its flames. Before 17 Nov 2026 each flame was a cell of its own color with a haze round it, and
 * a fire was a spray of orange dots.
 */
export const FLAME = { gathered: 2, gain: 2.6, from: 0.06, full: 0.26, sharp: 0.3, over: 0.4 };

/**
 * How the body of a fire is spread, in texels of the half-sized picture (two cells each): `across`, the
 * weights from the middle out to each side, narrow, so that flames side by side are tongues and not one
 * lump; `up`, the weights of the flames from where a point is down to some cells below it, so each flame
 * is drawn out above itself, fading, and nothing shows below the lowest. Each adds up to 1. Until
 * 26 Nov 2026 the body was blurred with the light, about five cells every way, and a fire was drawn as a
 * glowing rounded lump.
 */
export const TONGUE = { across: [0.5, 0.25], up: [0.22, 0.2, 0.17, 0.14, 0.11, 0.09, 0.07] };

/**
 * How strongly a soft cell is drawn itself, from 0 to 1; the rest of it is the haze spread around it. How
 * much a soft cell counts for where the haze is gathered; and how the haze is brought up where it is
 * thin: as 1 - e^(-`thick` x), so that a few cells of smoke far apart read as a wisp of smoke and not
 * as grey grains, while a thick cloud is no more solid than it was.
 */
export const SOFT_SHARP = 0.3;
const HAZE = { gathered: 0.4, thick: 4.5 };

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

/** Where a cell kept at column `x`, row `y` is seen, in a grid seen `columns` by `rows`, for `turn` quarter turns: `keptCell` undone. */
export function seenCell([x, y]: [number, number], turn: number, columns: number, rows: number): [x: number, y: number] {
    if (turn === 1) return [columns - 1 - y, x];
    if (turn === 2) return [columns - 1 - x, rows - 1 - y];
    if (turn === 3) return [y, rows - 1 - x];
    return [x, y];
}

/** A grid of cells drawn on a canvas. */
export interface Cells {
    /**
     * The colors: 2048 or 3072 bytes, two or three rows of 256. The first row is a color for each
     * value of a cell's first byte, red, green, blue and opacity, for a cell of middle shade; the
     * second is how far the second byte, from 0 to 255, moves red, green and blue, from darker to
     * lighter, and how it is drawn (`STRIPED`, `LIGHT`, `SOFT`, `DEEP`, `SPRAY`, added together). The third row is
     * the colors a striped cell picks from: its second byte over 4 is which, and its lowest two bits
     * a step of lightness, toward black or white by up to the second row's red.
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
    /**
     * Sends rows `from` to `to` to the graphics card and shows nothing yet: for a grid whose changed
     * rows lie in several runs, each sent by this, then all shown by one `draw` that sends none. With
     * `left` and `right`, only those columns of the rows are sent: what changed in one corner of a wide
     * grid is not sent across the whole of it.
     */
    send(bytes: Uint8Array, stride: number, border: number, from: number, to: number, left?: number, right?: number): void;
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
        // the stripe's color, each grain a step lighter or darker by its lowest two bits, toward
        // white or black by up to the shade range's red, as plain sand's grains vary: white can
        // only darken and near black only lighten, and the stripe still reads as its own color
        vec3 stripe = texelFetch(colors, ivec2(int(cell.g >> 2), 2), 0).rgb;
        float by = (float(cell.g & 3u) / 1.5 - 1.0) * vary.r;
        rgb = by < 0.0 ? stripe * (1.0 + by) : stripe + (1.0 - stripe) * by;
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
    float flame = 0.0;
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
                // a flame is soft and gives light: it is gathered into the body of the fire, by its heat
                if ((mode & 4u) != 0u) flame += 0.35 + 0.65 * eased;
            } else if ((mode & 4u) != 0u) haze += vec4(color.rgb * color.a, color.a);
        }
    }
    // the fourth number of the light is the fire's body
    light = vec4(shine * 0.25, min(flame * 0.25 * ${FLAME.gathered.toFixed(1)}, 1.0));
    soft = min(haze * ${HAZE.gathered.toFixed(2)}, 1.0);
}`;

/** Blurs both pictures one way, across or down, by the weights of `blurred`, into pictures of size `target`. */
const BLUR = (taps: number) => `#version 300 es
precision highp float;
uniform sampler2D light;
uniform sampler2D soft;
uniform vec2 step;
uniform vec2 target;
uniform float offsets[${taps}];
uniform float weights[${taps}];
const float TONGUE_ACROSS[${TONGUE.across.length}] = float[](${TONGUE.across.map((w) => w.toFixed(3)).join(", ")});
const float TONGUE_UP[${TONGUE.up.length}] = float[](${TONGUE.up.map((w) => w.toFixed(3)).join(", ")});
// 1 where the fire's body (the light's fourth number) is drawn out as tongues: narrowly across, and
// down only from below, so each flame shows above itself and not round itself
uniform int tongues;
layout(location = 0) out vec4 lightOut;
layout(location = 1) out vec4 softOut;
void main() {
    // by the size of the picture drawn into, so the same blur makes a smaller, wider one from a larger
    vec2 texel = 1.0 / target;
    vec2 uv = gl_FragCoord.xy * texel;
    vec2 way = step * texel;
    vec4 l = texture(light, uv) * weights[0];
    vec4 s = texture(soft, uv) * weights[0];
    for (int k = 1; k < ${taps}; k++) {
        vec2 off = way * offsets[k];
        l += (texture(light, uv + off) + texture(light, uv - off)) * weights[k];
        s += (texture(soft, uv + off) + texture(soft, uv - off)) * weights[k];
    }
    if (tongues == 1) {
        float body = 0.0;
        if (step.x > 0.0) {
            for (int k = -${TONGUE.across.length - 1}; k <= ${TONGUE.across.length - 1}; k++) body += texture(light, uv + way * float(k)).a * TONGUE_ACROSS[abs(k)];
        } else {
            // the pictures count rows up from the bottom: what lies below is at a smaller row
            for (int k = 0; k < ${TONGUE.up.length}; k++) body += texture(light, uv - way * float(k)).a * TONGUE_UP[k];
        }
        l.a = body;
    }
    lightOut = l;
    softOut = s;
}`;

/** How many cells across and down are drawn together in one pixel at most, when the view is far out. */
const TOGETHER = 4;

/** Draws the cells sharp, a soft cell faint over the blurred haze, and the blurred light added over it all. */
const FRAGMENT = `#version 300 es
precision highp float;
precision highp usampler2D;
${COLOR}
uniform sampler2D light;
uniform sampler2D soft;
uniform sampler2D far;
uniform vec2 origin;
uniform float scale;
uniform ivec2 size;
uniform int turn;
uniform vec2 grid;
uniform float glow;
out vec4 color;
// Where a cell seen at column and row \`seen\`, counted from the top left, is kept: \`keptCell\`.
ivec2 kept(ivec2 seen) {
    if (turn == 1) return ivec2(seen.y, size.x - 1 - seen.x);
    if (turn == 2) return ivec2(size.x - 1 - seen.x, size.y - 1 - seen.y);
    if (turn == 3) return ivec2(size.y - 1 - seen.y, seen.x);
    return seen;
}
// A cell as it is drawn itself, its color times its opacity: \`depth\` is how many cells above a deep one are looked at.
vec4 shade(ivec2 at, int depth) {
    uint mode;
    uvec4 raw = texelFetch(cells, at, 0);
    vec4 cell = colorOf(raw, mode);
    if ((mode & 8u) != 0u) {
        // a deep cell: lighter at the surface, darker the more of it lies above
        int over = 0;
        for (int k = 1; k <= ${DEPTH.cells}; k++) {
            if (k > depth || at.y - k < 0 || texelFetch(cells, ivec2(at.x, at.y - k), 0).r != raw.r) break;
            over++;
        }
        cell.rgb = clamp(cell.rgb * (over == 0 ? ${DEPTH.top.toFixed(2)} : 1.06 - ${DEPTH.step.toFixed(3)} * float(over)), 0.0, 1.0);
    }
    if ((mode & 16u) != 0u && (raw.a >> 4u) != 0u) {
        // spray: paler the faster it falls, and only as far as it is loose: a drop with air all round
        // it is spray, the edge of a falling body is flecked with it, and the inside of one is water
        ivec2 last = textureSize(cells, 0) - 1;
        float loose = 0.0;
        for (int k = 0; k < 4; k++) {
            ivec2 beside = at + ivec2(k == 0 ? -1 : k == 1 ? 1 : 0, k == 2 ? -1 : k == 3 ? 1 : 0);
            if (texelFetch(cells, clamp(beside, ivec2(0), last), 0).r != raw.r) loose += 0.5;
        }
        float fast = min(float(raw.a >> 4u) / ${FOAM.speed.toFixed(1)}, 1.0);
        cell.rgb = mix(cell.rgb, vec3(0.86, 0.93, 1.0), fast * min(loose, 1.0) * ${FOAM.pale.toFixed(2)});
    }
    vec4 sharp = vec4(cell.rgb * cell.a, cell.a);
    // a soft cell is fainter itself, the rest of it in the haze around it; strong enough that a wisp of
    // steam reads as light and not as a grey grain
    if ((mode & 4u) != 0u) sharp *= (mode & 2u) != 0u ? ${FLAME.sharp.toFixed(2)} : ${SOFT_SHARP.toFixed(2)};
    return sharp;
}
void main() {
    vec2 inside = (gl_FragCoord.xy - origin) / scale;
    // past the grid's edges nothing is drawn
    if (inside.x < 0.0 || inside.y < 0.0 || inside.x >= float(size.x) || inside.y >= float(size.y)) {
        color = vec4(0.0);
        return;
    }
    vec4 sharp;
    if (scale >= 1.0) {
        sharp = shade(kept(ivec2(int(inside.x), size.y - 1 - int(inside.y))), ${DEPTH.cells});
    } else {
        // cells smaller than a pixel: those a pixel covers are drawn together, so that a thread of water
        // one cell wide is a faint line and not a row of dots that comes and goes
        int n = min(int(ceil(1.0 / scale)), ${TOGETHER});
        // from the cell at the pixel's own corner, not its middle
        ivec2 first = ivec2(floor((gl_FragCoord.xy - 0.5 - origin) / scale + 0.001));
        vec4 sum = vec4(0.0);
        float count = 0.0;
        for (int dy = 0; dy < ${TOGETHER}; dy++) {
            for (int dx = 0; dx < ${TOGETHER}; dx++) {
                ivec2 at = first + ivec2(dx, dy);
                if (dx >= n || dy >= n || at.x < 0 || at.y < 0 || at.x >= size.x || at.y >= size.y) continue;
                sum += shade(kept(ivec2(at.x, size.y - 1 - at.y)), 3);
                count += 1.0;
            }
        }
        sharp = sum / max(count, 1.0);
    }
    // the same point among the cells as they are kept, which the pictures of light and haze follow,
    // counted up from the bottom as they are
    vec2 seen = vec2(inside.x, float(size.y) - inside.y);
    vec2 held = turn == 1 ? vec2(seen.y, float(size.x) - seen.x) : turn == 2 ? vec2(float(size.x) - seen.x, float(size.y) - seen.y) : turn == 3 ? vec2(float(size.y) - seen.y, seen.x) : seen;
    vec2 uv = vec2(held.x, float(turn == 1 || turn == 3 ? size.x : size.y) - held.y) / grid;
    vec4 haze = texture(soft, uv);
    // thin haze is brought up, so that scattered cells of a gas are a wisp and not grains
    if (haze.a > 0.001) haze *= (1.0 - exp(-${HAZE.thick.toFixed(1)} * haze.a)) / haze.a;
    vec4 out4 = sharp + haze * (1.0 - sharp.a);
    if (glow > 0.0) {
        // The body of a fire: how strong the gathered flames are here and below here (toward the ground
        // as the cells are kept), drawn out upward as tongues (\`TONGUE\`); colored by that strength.
        float body = texture(light, uv).a;
        float f = clamp(body * ${FLAME.gain.toFixed(2)}, 0.0, 1.0);
        if (f > 0.02) {
            vec3 fire = f < 0.3 ? mix(vec3(0.50, 0.05, 0.02), vec3(1.0, 0.36, 0.05), f / 0.3) : f < 0.65 ? mix(vec3(1.0, 0.36, 0.05), vec3(1.0, 0.80, 0.22), (f - 0.3) / 0.35) : mix(vec3(1.0, 0.80, 0.22), vec3(1.0, 0.97, 0.82), (f - 0.65) / 0.35);
            float cover = smoothstep(${FLAME.from.toFixed(2)}, ${FLAME.full.toFixed(2)}, f) * (1.0 - ${(1 - FLAME.over).toFixed(2)} * out4.a);
            out4 = vec4(mix(out4.rgb, fire, cover), max(out4.a, cover));
        }
    }
    // the light falls on the grains near fire and lava, and glows more strongly in the air round them
    vec3 lit = texture(light, uv).rgb * glow * (1.0 + ${GLOW_AIR.toFixed(2)} * (1.0 - sharp.a));
    // and, far wider and fainter, on everything round a fire
    lit += texture(far, uv).rgb * glow * ${HALO.strength.toFixed(2)};
    out4.rgb = min(out4.rgb + lit, 1.0);
    // light over empty cells is kept a color the page can blend: as opaque as it is bright
    out4.a = max(out4.a, max(out4.r, max(out4.g, out4.b)));
    color = out4;
}`;

/** How many samples the blur takes each way, the middle one counted: 1 and 3 pairs of texels, each pair read as one. */
const TAPS = 4;

/** A grid of cells on `canvas`, or undefined where the browser has no WebGL 2. */
export function cells(canvas: HTMLCanvasElement | OffscreenCanvas): Cells | undefined {
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
    /** The grid as it is kept: as wide as it is seen high when it is a quarter or three turned. */
    const kept = (of = at) => ((of.turn ?? 0) % 2 ? { columns: of.rows, rows: of.columns } : { columns: of.columns, rows: of.rows });
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
    /** Two more pairs, smaller again, for the wide halo. */
    let fars: [Pair, Pair] | undefined;
    const half = () => [Math.max(1, Math.ceil(kept().columns / 2)), Math.max(1, Math.ceil(kept().rows / 2))] as const;
    const small = () => [Math.max(1, Math.ceil(half()[0] / HALO.smaller)), Math.max(1, Math.ceil(half()[1] / HALO.smaller))] as const;
    const makePairs = () => {
        for (const pair of [...(pairs ?? []), ...(fars ?? [])]) {
            g.deleteTexture(pair.light);
            g.deleteTexture(pair.soft);
            g.deleteFramebuffer(pair.frame);
        }
        let [wide, high] = half();
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
        [wide, high] = small();
        fars = [one(), one()];
    };
    const bind = (unit: number, made: WebGLTexture) => {
        g.activeTexture(g.TEXTURE0 + unit);
        g.bindTexture(g.TEXTURE_2D, made);
    };

    /** Sends rows `from` to `to` of the cells to the graphics card, all their columns or those from `left` to `right`. */
    const send: Cells["send"] = (bytes, stride, border, from, to, left = 0, right = Infinity) => {
        if (!grid) return;
        from = Math.max(0, from);
        to = Math.min(kept().rows - 1, to);
        left = Math.max(0, left);
        right = Math.min(kept().columns - 1, right);
        if (to < from || right < left) return;
        stale = true;
        // read straight out of `bytes`, a row at a time with its frame stepped over
        g.activeTexture(g.TEXTURE0);
        g.bindTexture(g.TEXTURE_2D, grid);
        g.pixelStorei(g.UNPACK_ALIGNMENT, 4);
        g.pixelStorei(g.UNPACK_ROW_LENGTH, stride);
        g.pixelStorei(g.UNPACK_SKIP_PIXELS, border + left);
        g.pixelStorei(g.UNPACK_SKIP_ROWS, border + from);
        g.texSubImage2D(g.TEXTURE_2D, 0, left, from, right - left + 1, to - from + 1, g.RGBA_INTEGER, g.UNSIGNED_BYTE, bytes);
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
            const resized = !grid || kept(next).columns !== kept().columns || kept(next).rows !== kept().rows;
            at = next;
            if (resized) {
                if (grid) g.deleteTexture(grid);
                grid = texture(0);
                g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8UI, kept().columns, kept().rows);
                makePairs();
            }
            stale = true;
        },
        send,
        draw(bytes, stride, border, from, to) {
            if (!grid || !pairs || !fars) return;
            send(bytes, stride, border, from, to);
            if (!stale) return;
            stale = false;
            g.bindVertexArray(empty);
            bind(0, grid);
            bind(1, colors);
            const [wide, high] = half();
            if (effects) {
                // The light and the haze, gathered at half size, then blurred across and down, and the
                // blurred light across and down again at the halo's size: only over the part of the grid
                // the canvas shows and as far round it as the halo reaches, which in a grid far larger
                // than its canvas is a small part of it.
                // the columns and rows the canvas shows, as seen, then where those lie among the cells as kept
                const [sx0, sx1, sy0, sy1] = [-at.left / at.scale, (canvas.width - at.left) / at.scale, -at.top / at.scale, (canvas.height - at.top) / at.scale];
                const turn = at.turn ?? 0;
                const [kx0, kx1, ky0, ky1] = turn === 1 ? [sy0, sy1, at.columns - sx1, at.columns - sx0] : turn === 2 ? [at.columns - sx1, at.columns - sx0, at.rows - sy1, at.rows - sy0] : turn === 3 ? [at.rows - sy1, at.rows - sy0, sx0, sx1] : [sx0, sx1, sy0, sy1];
                const cut = (smaller: number, width: number, height: number) => {
                    const [x0, x1] = [Math.floor((kx0 - REACH) / smaller), Math.ceil((kx1 + REACH) / smaller)];
                    // rows are counted from the top in the grid and from the bottom in these pictures
                    const [y0, y1] = [Math.floor((kept().rows - ky1 - REACH) / smaller), Math.ceil((kept().rows - ky0 + REACH) / smaller)];
                    const [left, bottom] = [Math.max(0, x0), Math.max(0, y0)];
                    g.scissor(left, bottom, Math.max(0, Math.min(width, x1) - left), Math.max(0, Math.min(height, y1) - bottom));
                };
                g.enable(g.SCISSOR_TEST);
                g.viewport(0, 0, wide, high);
                cut(2, wide, high);
                g.bindFramebuffer(g.FRAMEBUFFER, pairs[0].frame);
                g.useProgram(gather.made);
                g.uniform1i(gather.at("cells"), 0);
                g.uniform1i(gather.at("colors"), 1);
                g.uniform2i(gather.at("size"), kept().columns, kept().rows);
                g.drawArrays(g.TRIANGLES, 0, 3);
                g.useProgram(blur.made);
                g.uniform1i(blur.at("light"), 2);
                g.uniform1i(blur.at("soft"), 3);
                g.uniform1fv(blur.at("offsets"), offsets);
                g.uniform1fv(blur.at("weights"), weights);
                const [less, lower] = small();
                for (const [source, target, way, size, smaller, tongues] of [[pairs[0], pairs[1], [1, 0], [wide, high], 2, 1], [pairs[1], pairs[0], [0, 1], [wide, high], 2, 1], [pairs[0], fars[1], [1, 0], [less, lower], 2 * HALO.smaller, 0], [fars[1], fars[0], [0, 1], [less, lower], 2 * HALO.smaller, 0]] as const) {
                    g.viewport(0, 0, size[0], size[1]);
                    cut(smaller, size[0], size[1]);
                    g.bindFramebuffer(g.FRAMEBUFFER, target.frame);
                    bind(2, source.light);
                    bind(3, source.soft);
                    g.uniform2f(blur.at("step"), way[0], way[1]);
                    g.uniform2f(blur.at("target"), size[0], size[1]);
                    g.uniform1i(blur.at("tongues"), tongues);
                    g.drawArrays(g.TRIANGLES, 0, 3);
                }
                g.bindFramebuffer(g.FRAMEBUFFER, null);
                g.disable(g.SCISSOR_TEST);
            }
            g.viewport(0, 0, canvas.width, canvas.height);
            g.clearColor(0, 0, 0, 0);
            g.clear(g.COLOR_BUFFER_BIT);
            g.useProgram(drawn.made);
            g.uniform1i(drawn.at("cells"), 0);
            g.uniform1i(drawn.at("colors"), 1);
            g.uniform1i(drawn.at("light"), 2);
            g.uniform1i(drawn.at("soft"), 3);
            g.uniform2f(drawn.at("origin"), at.left, canvas.height - at.top - at.rows * at.scale);
            g.uniform1f(drawn.at("scale"), at.scale);
            g.uniform2i(drawn.at("size"), at.columns, at.rows);
            g.uniform1i(drawn.at("turn"), at.turn ?? 0);
            // the half-sized pictures cover a whole number of texels, a cell more than the grid when it is odd
            g.uniform2f(drawn.at("grid"), wide * 2, high * 2);
            g.uniform1i(drawn.at("far"), 4);
            g.uniform1f(drawn.at("glow"), effects ? 1 : 0);
            bind(0, grid);
            bind(1, colors);
            bind(2, pairs[0].light);
            bind(3, pairs[0].soft);
            bind(4, fars[0].light);
            g.drawArrays(g.TRIANGLES, 0, 3);
        },
        dispose() {
            if (grid) g.deleteTexture(grid);
            for (const pair of [...(pairs ?? []), ...(fars ?? [])]) {
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
