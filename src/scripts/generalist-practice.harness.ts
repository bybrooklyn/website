// The practice worker as a test runs it in Bun: the same script, its engine fetched from public/
// rather than from a server. Only generalist-practice.test.ts starts it. Messages that come before the
// script has set its handler are held and handed to it once it has. A worker started with the argument
// "faulty" has an engine whose third update throws, as a trap in the engine would.

const served = new URL("../../public", import.meta.url);
globalThis.fetch = (async (address: string | URL | Request) => new Response(Bun.file(`${served.pathname}${String(address)}`))) as typeof fetch;
if (process.argv.includes("faulty")) {
    const instantiate = WebAssembly.instantiate.bind(WebAssembly) as (bytes: BufferSource, imports: WebAssembly.Imports) => Promise<WebAssembly.WebAssemblyInstantiatedSource>;
    let updates = 0;
    WebAssembly.instantiate = (async (bytes: BufferSource, imports: WebAssembly.Imports) => {
        const made = await instantiate(bytes, imports);
        const exports = { ...made.instance.exports } as Record<string, unknown>;
        const update = exports.practice_update as () => number;
        exports.practice_update = () => {
            if (++updates === 3) throw new WebAssembly.RuntimeError("unreachable");
            return update();
        };
        return { module: made.module, instance: { exports } as WebAssembly.Instance };
    }) as typeof WebAssembly.instantiate;
}
const early: MessageEvent[] = [];
onmessage = (event: MessageEvent) => early.push(event);
await import("./generalist-practice");
for (const event of early) onmessage?.call(globalThis as unknown as Window, event);
