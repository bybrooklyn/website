// Opens the microphone and hands the page its sound as 16 kHz mono frames, by way of the
// AudioWorklet in capture-worklet.ts. Closing it stops the microphone, so the browser's recording
// light goes out. Dictation closes it the moment it is switched off (by the button, by itself after
// quiet, or by a spoken command), before the last phrase has finished being recognized. Whatever
// goes wrong while it is being opened, what was opened is closed again; and when the microphone is
// taken away (unplugged, its permission withdrawn, the sound interrupted by the system) it closes
// itself and says so.

// the worklet is built as a file of its own and served from the site, which its policy needs
import workletFile from "./capture-worklet.ts?worker&url";

/** A microphone that is open. Closing it twice is the same as once. */
export interface Microphone {
    close(): void;
}

/** Why a microphone could not be opened, in words for the panel. */
export class MicrophoneError extends Error {}

/** Whether this browser can capture sound at all. */
export const canListen = (): boolean => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";

/** How long the sound may take to start, in milliseconds, before the microphone is given up as one that cannot be captured here. */
const START = 3000;

/** Opens the microphone and calls `onFrame` with each frame of 1600 samples, and `onLost` once if the microphone is taken away while open. */
export async function openMicrophone(onFrame: (frame: Float32Array) => void, onLost?: () => void, how: { wait?: number } = {}): Promise<Microphone> {
    let stream: MediaStream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        throw new MicrophoneError(name === "NotAllowedError" ? "The microphone was not allowed. Allow it for this site in the browser's address bar and try again." : name === "NotFoundError" ? "No microphone was found." : "The microphone could not be opened.");
    }
    let context: AudioContext | undefined;
    let node: AudioWorkletNode | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        if (node) node.port.onmessage = null;
        source?.disconnect();
        node?.disconnect();
        for (const track of stream.getTracks()) {
            track.onended = null;
            track.stop();
        }
        if (context) {
            context.onstatechange = null;
            void context.close().catch(() => undefined);
        }
    };
    try {
        context = new AudioContext({ latencyHint: "interactive" });
        await context.audioWorklet.addModule(workletFile);
        node = new AudioWorkletNode(context, "mdquire-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
        node.port.onmessage = (event: MessageEvent<Float32Array>) => onFrame(event.data);
        source = context.createMediaStreamSource(stream);
        source.connect(node);
        // a context made far from the press can wait for ever to start in some browsers: it is given a few seconds
        if (context.state === "suspended") {
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([context.resume(), new Promise((_, fail) => (timer = setTimeout(() => fail(new Error("the sound did not start")), how.wait ?? START)))]).finally(() => clearTimeout(timer));
        }
    } catch {
        close();
        throw new MicrophoneError("The sound could not be captured in this browser.");
    }
    const lost = () => {
        if (closed) return;
        close();
        onLost?.();
    };
    for (const track of stream.getAudioTracks()) track.onended = lost;
    const running = context;
    running.onstatechange = () => {
        if ((running.state as string) === "closed" || (running.state as string) === "interrupted") lost();
    };
    return { close };
}
