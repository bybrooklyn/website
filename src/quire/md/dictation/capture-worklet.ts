// The microphone's side of dictation, in an AudioWorklet so that it runs on the audio thread and
// never waits for the page. The sound is turned into 16 kHz mono frames of a tenth of a second
// (resample.ts) and posted to the page. A shell around tested code: it cannot be loaded outside a
// browser's audio thread.

import { createDownsampler } from "./resample";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor & { process(inputs: Float32Array[][]): boolean }): void;

class Capture extends AudioWorkletProcessor {
    private down = createDownsampler(sampleRate);

    process(inputs: Float32Array[][]): boolean {
        for (const frame of this.down.push(inputs[0] ?? [])) this.port.postMessage(frame, [frame.buffer]);
        return true;
    }
}

registerProcessor("mdquire-capture", Capture);
