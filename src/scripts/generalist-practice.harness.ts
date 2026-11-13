// The practice worker as a test runs it in Bun: the same script, its engine fetched from public/
// rather than from a server. Only generalist-practice.test.ts starts it. Messages that come before the
// script has set its handler are held and handed to it once it has.

const served = new URL("../../public", import.meta.url);
globalThis.fetch = (async (address: string | URL | Request) => new Response(Bun.file(`${served.pathname}${String(address)}`))) as typeof fetch;
const early: MessageEvent[] = [];
onmessage = (event: MessageEvent) => early.push(event);
await import("./generalist-practice");
for (const event of early) onmessage?.(event);
