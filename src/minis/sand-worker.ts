// The sand mini's core (sand-core.ts) run in a worker: the world steps and is drawn here, on a canvas
// the page handed over, so that a step that takes long holds up nothing else on the page.

import { core, type ToCore } from "./sand-core";

const scope = self as unknown as { onmessage: ((event: MessageEvent<ToCore>) => void) | null; postMessage(message: unknown, transfer: Transferable[]): void };
const handle = core((message, transfer) => scope.postMessage(message, transfer ?? []));
scope.onmessage = (event) => handle(event.data);
