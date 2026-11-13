// Makes the resume's PDF from the resume page itself, so the two cannot drift
// apart. After a build, the built page is printed to one sheet with the
// Chromium on this machine and saved beside it. On the dev server the PDF is
// printed fresh each time it is asked for.

import type { AstroIntegration } from "astro";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../scripts/browser";

/** Where the PDF is served. src/lib/resume.ts links to the same address. */
const ADDRESS = "/resume/charlotte-resume.pdf";
const PAGE = "/resume/";

const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".js": "text/javascript",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
    ".webp": "image/webp",
    ".png": "image/png",
};

/**
 * Print a page to a PDF file. Returns how many pages it came to. Chromium is given a profile folder
 * of its own, so that it never hands the job to a Chromium already open (which can end without
 * writing anything), and is stopped if it takes longer than `limit` milliseconds.
 */
export async function print(browser: string, url: string, output: string, limit = 60_000): Promise<number> {
    // an old file left where the new one goes must not be taken for it
    rmSync(output, { force: true });
    const profile = mkdtempSync(join(tmpdir(), "resume-print-"));
    try {
        await new Promise<void>((resolve, reject) => {
            const run = spawn(browser, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--user-data-dir=${profile}`, `--print-to-pdf=${output}`, url], { stdio: "ignore", detached: true });
            const timer = setTimeout(() => {
                try {
                    process.kill(-run.pid!, "SIGKILL");
                } catch {
                    run.kill("SIGKILL");
                }
                reject(new Error(`Chromium took more than ${limit / 1000} s to print the resume, and was stopped.`));
            }, limit);
            run.on("error", (error) => {
                clearTimeout(timer);
                reject(error);
            });
            run.on("exit", (code) => {
                clearTimeout(timer);
                if (code === 0) resolve();
                else reject(new Error(`Chromium exited with ${code} while printing the resume.`));
            });
        });
    } finally {
        rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
    }
    if (!existsSync(output)) throw new Error("Chromium finished without writing the resume's PDF.");
    return (readFileSync(output, "latin1").match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
}

export default function resumePdf(): AstroIntegration {
    return {
        name: "resume-pdf",
        hooks: {
            "astro:server:setup": ({ server, logger }) => {
                server.middlewares.use((request, response, next) => {
                    if (request.url?.split("?")[0] !== ADDRESS) return next();
                    const browser = chromium();
                    const port = (server.httpServer?.address() as AddressInfo | null)?.port;
                    if (!browser || !port) {
                        response.statusCode = 503;
                        response.end("The PDF needs Chromium or Chrome on this machine.");
                        return;
                    }
                    // a folder of its own for each request, so that two at once do not share a file
                    const folder = mkdtempSync(join(tmpdir(), "resume-"));
                    const output = join(folder, "resume.pdf");
                    print(browser, `http://localhost:${port}${PAGE}`, output)
                        .then(
                            () => {
                                response.setHeader("Content-Type", "application/pdf");
                                response.setHeader("Cache-Control", "no-store");
                                response.end(readFileSync(output));
                            },
                            (error: unknown) => {
                                logger.error(String(error));
                                response.statusCode = 500;
                                response.end("The resume could not be printed.");
                            },
                        )
                        .finally(() => rmSync(folder, { recursive: true, force: true }));
                });
            },

            "astro:build:done": async ({ dir, logger }) => {
                const built = fileURLToPath(dir);
                // A resume that is still a draft is not built, and gets no PDF.
                if (!existsSync(join(built, PAGE, "index.html"))) return;
                const browser = chromium();
                if (!browser) throw new Error("The resume's PDF needs Chromium or Chrome on this machine, and none was found.");

                // The built files, served just long enough to print one page of them.
                const files = createServer((request, response) => {
                    const path = normalize(decodeURIComponent((request.url ?? "/").split("?")[0]!));
                    let file = join(built, path);
                    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
                    if (!file.startsWith(built) || !existsSync(file)) {
                        response.statusCode = 404;
                        response.end();
                        return;
                    }
                    response.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
                    response.end(readFileSync(file));
                });
                await new Promise<void>((resolve) => files.listen(0, "127.0.0.1", resolve));
                try {
                    const { port } = files.address() as AddressInfo;
                    const pages = await print(browser, `http://127.0.0.1:${port}${PAGE}`, join(built, ADDRESS));
                    if (pages !== 1) throw new Error(`The resume prints to ${pages} pages; it has to fit on one.`);
                    logger.info(`printed ${ADDRESS}`);
                } finally {
                    files.close();
                }
            },
        },
    };
}
