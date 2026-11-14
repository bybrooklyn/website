// What it would cost the sand mini to spread heat somewhere other than its one thread, measured in a
// browser (stage 4 of docs/sand.md): how long a barrier among four workers sharing memory takes; how
// long sending the whole grid to the graphics card, running one pass the size of the heat pass on it,
// and reading the result back takes, at the page's size and the largest; and, beside them, how long the
// built engine takes over a step of a forest fire at each size, about half of which is the heat pass.
// The page is served with the two headers that let it share memory between workers.
//
// `bun scripts/sand-spread.ts` measures in headless Chromium, which draws in software (SwiftShader), and
// prints the numbers; `bun scripts/sand-spread.ts --serve` only serves the page and prints its address, to
// be opened in a browser with a real graphics card, where the numbers are shown on the page.

import { browser } from "./browser";
import { at } from "./lib";

const page = `<!doctype html><meta charset="utf-8"><title>sand: what spreading heat elsewhere costs</title><pre id="out">measuring</pre><script>
const helper = \`onmessage = ({ data: { shared, index } }) => {
    const flags = new Int32Array(shared);
    let seen = 0;
    for (;;) {
        Atomics.wait(flags, 0, seen);
        seen = Atomics.load(flags, 0);
        if (seen < 0) return;
        let x = 0;
        for (let k = 0; k < 200; k++) x += k * index;
        flags[8 + index] = x;
        if (Atomics.add(flags, 1, 1) === 2) Atomics.notify(flags, 1);
    }
};\`;
const lead = \`onmessage = ({ data: { shared, rounds } }) => {
    const flags = new Int32Array(shared);
    const start = performance.now();
    for (let round = 1; round <= rounds; round++) {
        Atomics.store(flags, 1, 0);
        Atomics.store(flags, 0, round);
        Atomics.notify(flags, 0);
        while (Atomics.load(flags, 1) < 3) Atomics.wait(flags, 1, Atomics.load(flags, 1));
    }
    const took = performance.now() - start;
    Atomics.store(flags, 0, -1);
    Atomics.notify(flags, 0);
    postMessage(took / rounds);
};\`;
const script = (source) => URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
async function barrier(rounds) {
    const shared = new SharedArrayBuffer(64);
    for (let index = 0; index < 3; index++) new Worker(script(helper)).postMessage({ shared, index });
    await new Promise((done) => setTimeout(done, 200));
    const worker = new Worker(script(lead));
    return new Promise((done) => {
        worker.onmessage = ({ data }) => done(data * 1000);
        worker.postMessage({ shared, rounds });
    });
}
function card(wide, high, rounds) {
    const g = document.createElement("canvas").getContext("webgl2");
    const shader = (kind, source) => { const made = g.createShader(kind); g.shaderSource(made, source); g.compileShader(made); return made; };
    const program = g.createProgram();
    g.attachShader(program, shader(g.VERTEX_SHADER, "#version 300 es\\nvoid main() { vec2 c = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(c * 2.0 - 1.0, 0.0, 1.0); }"));
    g.attachShader(program, shader(g.FRAGMENT_SHADER, "#version 300 es\\nprecision highp float; precision highp usampler2D; uniform usampler2D cells; out uvec4 color;\\nvoid main() { ivec2 at = ivec2(gl_FragCoord.xy); uvec4 c = texelFetch(cells, at, 0); uint sum = texelFetch(cells, at + ivec2(1, 0), 0).b + texelFetch(cells, at - ivec2(1, 0), 0).b + texelFetch(cells, at + ivec2(0, 1), 0).b + texelFetch(cells, at - ivec2(0, 1), 0).b; color = uvec4(c.r, c.g, (c.b * 4u + sum * 2u) / 12u, (sum * 2654435761u) >> 24u); }"));
    g.linkProgram(program);
    const texture = () => { const made = g.createTexture(); g.bindTexture(g.TEXTURE_2D, made); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.NEAREST); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.NEAREST); g.texStorage2D(g.TEXTURE_2D, 1, g.RGBA8UI, wide, high); return made; };
    const cells = texture();
    const out = texture();
    g.bindFramebuffer(g.FRAMEBUFFER, g.createFramebuffer());
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, out, 0);
    const bytes = new Uint8Array(wide * high * 4).map((_, k) => (k * 2654435761) >>> 24);
    const back = new Uint32Array(wide * high * 4);
    g.useProgram(program);
    g.viewport(0, 0, wide, high);
    const once = () => {
        g.bindTexture(g.TEXTURE_2D, cells);
        g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, wide, high, g.RGBA_INTEGER, g.UNSIGNED_BYTE, bytes);
        g.drawArrays(g.TRIANGLES, 0, 3);
        g.readPixels(0, 0, wide, high, g.RGBA_INTEGER, g.UNSIGNED_INT, back);
    };
    for (let k = 0; k < 10; k++) once();
    let start = performance.now();
    for (let k = 0; k < rounds; k++) once();
    const whole = (performance.now() - start) / rounds;
    start = performance.now();
    for (let k = 0; k < rounds; k++) g.readPixels(0, 0, wide, high, g.RGBA_INTEGER, g.UNSIGNED_INT, back);
    return { whole, readBack: (performance.now() - start) / rounds, renderer: g.getParameter(g.RENDERER) };
}
async function forest(wide, high) {
    const e = (await WebAssembly.instantiate(await (await fetch("/sand.wasm")).arrayBuffer(), {})).instance.exports;
    e.create(wide, high, 1, 0);
    e.paint(4, 0, high - 6, wide - 1, high - 1, 3, 100, 0);
    for (let x = 6, k = 0; x < wide - 4; x += 9, k++) {
        const top = Math.floor((high * 220) / 576) + ((k * 7) % 5) * 2;
        e.paint(8, x, top, x, high - 8, 1, 100, 0);
        e.paint(8, x, top, x, top, 4, 100, 0);
    }
    let total = 0;
    for (let k = 0; k < 1200; k++) {
        if (k < 40) e.paint(13, 0, high - 14, wide - 1, high - 14, 2, 30, 0);
        const start = performance.now();
        e.step(1);
        total += performance.now() - start;
    }
    return total / 1200;
}
window.results = (async () => {
    const results = {
        isolated: crossOriginIsolated,
        cores: navigator.hardwareConcurrency,
        "a barrier among four workers, microseconds": await barrier(2000),
        "the grid to the graphics card and back, 373 by 280, ms": card(373, 280, 100),
        "the grid to the graphics card and back, 1024 by 576, ms": card(1024, 576, 50),
        "a step of a forest fire, 373 by 280, ms": await forest(373, 280),
        "a step of a forest fire, 1024 by 576, ms": await forest(1024, 576),
    };
    document.getElementById("out").textContent = JSON.stringify(results, null, 1);
    return results;
})();
</script>`;

const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
const server = Bun.serve({
    port: 0,
    fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/sand.wasm") return new Response(Bun.file(at("public/wasm/sand.wasm")), { headers: { ...headers, "Content-Type": "application/wasm" } });
        return new Response(page, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
    },
});
const address = `http://localhost:${server.port}/`;

if (process.argv.includes("--serve")) {
    console.log(`open ${address} in a browser; stop with Ctrl+C`);
} else {
    const tab = await browser();
    try {
        await tab.open(address, 500);
        console.log(JSON.stringify(await tab.run("window.results"), null, 1));
        if (tab.errors.length > 0) throw new Error(tab.errors.join("; "));
    } finally {
        await tab.close();
        server.stop(true);
    }
}
