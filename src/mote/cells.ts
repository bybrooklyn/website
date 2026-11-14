// Mote's drawing of a grid of cells, each a whole number of pixels: a falling sand world, a game of
// life, a tile map. The cells are four bytes each, read straight from wherever they are kept (a
// WebAssembly module's memory, say) into one texture, and colored by the graphics card: the first
// byte picks a color from a palette, the second moves it lighter or darker. WebGL 2, no library.
//
//   const grid = cells(canvas);                   // undefined where WebGL 2 is missing
//   grid.palette(colors);                         // 256 colors, then 256 shade ranges (see `palette`)
//   grid.place(fitted(canvas.width, canvas.height, columns, rows));
//   grid.draw(bytes, stride, border, 0, rows - 1); // the rows that changed, then the whole grid is shown

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

/** A grid of cells drawn on a canvas. */
export interface Cells {
    /**
     * The colors: 2048 bytes, two rows of 256. The first row is a color for each value of a cell's
     * first byte, red, green, blue and opacity, for a cell of middle shade; the second is how far the
     * second byte, from 0 to 255, moves red, green and blue, from darker to lighter.
     */
    palette(colors: Uint8Array): void;
    /** Where the grid is drawn. A new size makes a new texture, so the next `draw` should send every row. */
    place(at: Place): void;
    /**
     * Sends rows `from` to `to` (both counted; none when `to` is less than `from`) of the cells to the
     * graphics card, and shows the whole grid. `bytes` holds `stride` cells to a row, the grid starting
     * `border` cells in from the left and from the top, as a grid with a frame around it is kept.
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

const FRAGMENT = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D cells;
uniform sampler2D colors;
uniform vec2 origin;
uniform float scale;
uniform int rows;
out vec4 color;
void main() {
    ivec2 at = ivec2((gl_FragCoord.xy - origin) / scale);
    at.y = rows - 1 - at.y;
    uvec4 cell = texelFetch(cells, at, 0);
    vec4 base = texelFetch(colors, ivec2(int(cell.r), 0), 0);
    vec3 vary = texelFetch(colors, ivec2(int(cell.r), 1), 0).rgb;
    vec3 rgb = clamp(base.rgb + (float(cell.g) / 255.0 - 0.5) * vary, 0.0, 1.0);
    color = vec4(rgb * base.a, base.a);
}`;

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
    const program = g.createProgram();
    g.attachShader(program, shader(g.VERTEX_SHADER, VERTEX));
    g.attachShader(program, shader(g.FRAGMENT_SHADER, FRAGMENT));
    g.linkProgram(program);
    if (!g.getProgramParameter(program, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(program) ?? "the shaders did not link");
    const where = (name: string) => g.getUniformLocation(program, name);
    const empty = g.createVertexArray();

    const texture = (unit: number) => {
        const made = g.createTexture();
        g.activeTexture(g.TEXTURE0 + unit);
        g.bindTexture(g.TEXTURE_2D, made);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
        g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
        return made;
    };
    const colors = texture(1);
    g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8, 256, 2);
    let grid: WebGLTexture | undefined;
    let at: Place = { columns: 0, rows: 0, scale: 1, left: 0, top: 0 };

    return {
        palette(bytes) {
            g.activeTexture(g.TEXTURE1);
            g.bindTexture(g.TEXTURE_2D, colors);
            g.pixelStorei(g.UNPACK_ROW_LENGTH, 0);
            g.pixelStorei(g.UNPACK_SKIP_PIXELS, 0);
            g.pixelStorei(g.UNPACK_SKIP_ROWS, 0);
            g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 256, 2, g.RGBA, g.UNSIGNED_BYTE, bytes);
        },
        place(next) {
            if (!grid || next.columns !== at.columns || next.rows !== at.rows) {
                if (grid) g.deleteTexture(grid);
                grid = texture(0);
                g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8UI, next.columns, next.rows);
            }
            at = next;
        },
        draw(bytes, stride, border, from, to) {
            if (!grid) return;
            from = Math.max(0, from);
            to = Math.min(at.rows - 1, to);
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
            g.viewport(0, 0, canvas.width, canvas.height);
            g.clearColor(0, 0, 0, 0);
            g.clear(g.COLOR_BUFFER_BIT);
            const bottom = canvas.height - at.top - at.rows * at.scale;
            g.viewport(at.left, bottom, at.columns * at.scale, at.rows * at.scale);
            g.useProgram(program);
            g.uniform1i(where("cells"), 0);
            g.uniform1i(where("colors"), 1);
            g.uniform2f(where("origin"), at.left, bottom);
            g.uniform1f(where("scale"), at.scale);
            g.uniform1i(where("rows"), at.rows);
            g.activeTexture(g.TEXTURE0);
            g.bindTexture(g.TEXTURE_2D, grid);
            g.activeTexture(g.TEXTURE1);
            g.bindTexture(g.TEXTURE_2D, colors);
            g.bindVertexArray(empty);
            g.drawArrays(g.TRIANGLES, 0, 3);
        },
        dispose() {
            if (grid) g.deleteTexture(grid);
            g.deleteTexture(colors);
            g.deleteProgram(program);
            g.deleteVertexArray(empty);
        },
    };
}
