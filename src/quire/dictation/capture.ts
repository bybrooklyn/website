// Opens the microphone and hands the page its sound as 16 kHz mono frames, by way of the
// AudioWorklet in capture-worklet.ts. Closing it stops the microphone, so the browser's recording
// light goes out the moment dictation is switched off.

// the worklet is built as a file of its own and served from the site, which its policy needs
import workletFile from "./capture-worklet.ts?worker&url";

/** A microphone that is open. */
export interface Microphone {
    close(): void;
}

/** Why a microphone could not be opened, in words for the panel. */
export class MicrophoneError extends Error {}

/** Whether this browser can capture sound at all. */
export const canListen = (): boolean => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";

/** Opens the microphone and calls `onFrame` with each frame of 1600 samples. */
export async function openMicrophone(onFrame: (frame: Float32Array) => void): Promise<Microphone> {
    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        throw new MicrophoneError(name === "NotAllowedError" ? "The microphone was not allowed. Allow it for this site in the browser's address bar and try again." : name === "NotFoundError" ? "No microphone was found." : "The microphone could not be opened.");
    }
    const context = new AudioContext({ latencyHint: "interactive" });
    try {
        await context.audioWorklet.addModule(workletFile);
    } catch {
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
        throw new MicrophoneError("The sound could not be captured in this browser.");
    }
    const node = new AudioWorkletNode(context, "mdquire-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
    node.port.onmessage = (event: MessageEvent<Float32Array>) => onFrame(event.data);
    const source = context.createMediaStreamSource(stream);
    source.connect(node);
    if (context.state === "suspended") await context.resume();
    return {
        close() {
            node.port.onmessage = null;
            source.disconnect();
            node.disconnect();
            stream.getTracks().forEach((track) => track.stop());
            void context.close();
        },
    };
}
