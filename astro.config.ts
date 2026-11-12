import { defineConfig, fontProviders } from "astro/config";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { satteri } from "@astrojs/markdown-satteri";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import cspCheck from "./integrations/csp-check";
import privateLinks from "./integrations/private-links";
import pruneAssets from "./integrations/prune-assets";
import resumePdf from "./integrations/resume-pdf";

// Astro hashes the scripts it processes, but not one written inline as is. The
// page-transition script has to be inline, so its hash is worked out here from the same file.
const transition = createHash("sha256").update(readFileSync(new URL("./src/scripts/transition.js", import.meta.url))).digest("base64");

// The files of ONNX Runtime that dictation fetches, copied as they are (no hash in the name) into /ort/.
// The two JavaScript entries are the WebAssembly-only one (ort.wasm.min.mjs) and the one with WebGPU (ort.min.mjs); each is paired with the
// .wasm file and glue it loads, so a browser downloads only the pair it can use. To ship a smaller
// build made by hand, replace the files in this list (src/quire/dictation/parakeet/RUNTIME.md).
const ORT = ["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm", "ort.min.mjs", "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];
const ortFolder = fileURLToPath(new URL("./node_modules/onnxruntime-web/dist/", import.meta.url));
type Answer = { setHeader(name: string, value: string): void; end(body: Buffer): void };
const ortFiles = {
    name: "ort-files",
    hooks: {
        "astro:build:done": ({ dir }: { dir: URL }) => {
            const out = `${fileURLToPath(dir)}ort`;
            mkdirSync(out, { recursive: true });
            for (const file of ORT) copyFileSync(`${ortFolder}${file}`, `${out}/${file}`);
        },
        // in `astro dev` the same files are answered from where they are
        "astro:server:setup": ({ server }: { server: { middlewares: { use(path: string, handler: (request: { url?: string }, response: Answer, next: () => void) => void): void } } }) => {
            server.middlewares.use("/ort/", (request, response, next) => {
                const name = (request.url ?? "").slice(1).split("?")[0] ?? "";
                if (!ORT.includes(name)) return next();
                response.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
                response.end(readFileSync(`${ortFolder}${name}`));
            });
        },
    },
};

export default defineConfig({
    site: "https://bybrooklyn.dev",
    trailingSlash: "always",
    build: {
        // The stylesheets are small, and a page that carries its own styles
        // can be drawn after one round trip instead of three.
        inlineStylesheets: "always",
    },
    // The site's two typefaces. Astro writes their @font-face rules and a
    // fallback matched to each one's proportions, so text moves less when the
    // real font arrives. Document.astro puts them in every page's head. The
    // files are the trimmed copies scripts/trim-fonts.py makes.
    fonts: [
        {
            provider: fontProviders.local(),
            name: "Torrens Serif",
            cssVariable: "--font-torrens",
            fallbacks: ["Georgia", "serif"],
            options: {
                variants: [
                    { src: ["./src/assets/fonts/torrens-serif.woff2"], weight: "100 900", style: "normal" },
                    { src: ["./src/assets/fonts/torrens-serif-italic.woff2"], weight: "100 900", style: "italic" },
                ],
            },
        },
        {
            provider: fontProviders.local(),
            name: "Drafting Mono",
            cssVariable: "--font-mono",
            fallbacks: ["ui-monospace", "Courier New", "monospace"],
            options: {
                variants: [{ src: ["./src/assets/fonts/drafting-mono.woff2"], weight: "100 700", style: "normal" }],
            },
        },
    ],
    security: {
        // Every inline script and style is hashed at build time and only those may run,
        // in a <meta> on each page. Inline style attributes (the theme's colors, the
        // blurred previews) are allowed as attributes only.
        csp: {
            directives: [
                "default-src 'self'",
                "img-src 'self' data:",
                "media-src 'self'",
                "font-src 'self'",
                // Project pages ask GitHub for a repository's current stars, forks and last push.
                // Dictation fetches its speech model from Hugging Face, which sends the large files on
                // from its own content network (the .hf.co hosts). Nothing else is added for it:
                // ONNX Runtime's .wasm file and the workers are served from the site itself.
                "connect-src 'self' https://api.github.com https://huggingface.co https://*.hf.co",
                "frame-src https:",
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'self'",
                // The Walker mini trains in a worker, a script of the site's own.
                "worker-src 'self'",
            ],
            scriptDirective: {
                // 'wasm-unsafe-eval' lets a page compile WebAssembly (the Walker mini's engine) and
                // nothing else: eval and new Function stay blocked.
                resources: ["'self'", "'wasm-unsafe-eval'"],
                hashes: [`sha256-${transition}`],
            },
            styleDirective: {
                resources: [
                    { resource: "'self'", kind: "element" },
                    { resource: "'unsafe-inline'", kind: "attribute" },
                ],
            },
        },
    },
    // Start fetching a page as soon as a link to it is hovered, focused or
    // touched. Astro holds back by itself on data-saving or very slow connections.
    prefetch: {
        prefetchAll: true,
    },
    integrations: [
        mdx(),
        // the page for trying the editor is not one for visitors to find
        sitemap({ filter: (page) => !page.includes("/mdquire") }),
        resumePdf(),
        cspCheck(),
        privateLinks(),
        pruneAssets(),
        ortFiles,
    ],
    // Workers are built as modules, because the dictation worker loads ONNX Runtime
    // with import(), which a single-file worker cannot do.
    vite: { worker: { format: "es" } },
    markdown: {
        processor: satteri({
            features: { smartPunctuation: true },
        }),
        shikiConfig: {
            // Code takes its colors from the theme; see tokens.css.
            theme: "css-variables",
        },
    },
});
