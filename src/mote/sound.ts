// Mote's sound: short knocks and tones made by the browser itself, with no files. It is silent until
// the visitor turns it on with the button this gives, and stays as they left it between visits.
//
//   const sound = sounds(m);
//   panel.append(sound.button);
//   sound.knock(0.6, 900);      // how hard, from 0 to 1, and how high, in hertz
//   sound.tone(660, 0.25);      // a clear note, and how long it rings
//   sound.glide(180, 40, 0.9);  // a note that slides from one pitch to another as it dies away

import type { Mote } from "./stage";

export interface Sounds {
    /** A short dry knock: one thing hitting another. */
    knock(hard: number, pitch?: number): void;
    /** A clear note that dies away. */
    tone(pitch: number, seconds?: number, loud?: number): void;
    /** A note that slides from one pitch to another while it dies away: a swoop up, or a fall. */
    glide(from: number, to: number, seconds?: number, loud?: number): void;
    /** Turns the sound on and off. */
    readonly button: HTMLButtonElement;
}

/** At most this many knocks start in any one stretch of 30 ms: a pile of things landing together is one noise, not forty. */
const TOGETHER = 4;

export function sounds(m: Mote): Sounds {
    let on = m.recall("sound", false);
    let out: AudioContext | undefined;
    let hiss: AudioBuffer | undefined;
    let recent: number[] = [];

    const button = document.createElement("button");
    button.type = "button";
    button.className = "quiet";
    const say = () => {
        button.textContent = on ? "sound: on" : "sound: off";
        button.setAttribute("aria-pressed", String(on));
    };
    say();
    button.onclick = () => {
        on = !on;
        m.keep("sound", on);
        say();
        ready();
    };

    /**
     * The browser's sound, made the first time it is needed, and nothing at all while the sound is off.
     * A browser holds it back until the visitor has pressed something: made before that (sound left on
     * from a last visit, and a roll opened from a link), or made by a press that Safari does not count,
     * it waits, and is started here, or at the next press anywhere on the page.
     */
    const ready = (): AudioContext | undefined => {
        if (!on || typeof AudioContext === "undefined") return undefined;
        if (!out) {
            out = new AudioContext();
            // a fifth of a second of noise, which a knock is a filtered piece of
            hiss = out.createBuffer(1, out.sampleRate / 5, out.sampleRate);
            const samples = hiss.getChannelData(0);
            for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        }
        if (out.state === "suspended") void out.resume().catch(() => {});
        return out.state === "running" ? out : undefined;
    };
    for (const name of ["pointerup", "keydown", "touchend"]) document.addEventListener(name, () => void (out?.state === "suspended" && ready()), { capture: true, passive: true });
    /** A volume that starts at `loud` and dies away over `seconds`. */
    const fading = (audio: AudioContext, loud: number, seconds: number): GainNode => {
        const volume = audio.createGain();
        volume.gain.setValueAtTime(loud, audio.currentTime);
        volume.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + seconds);
        volume.connect(audio.destination);
        return volume;
    };

    return {
        button,
        knock(hard, pitch = 800) {
            const audio = ready();
            if (!audio || hard <= 0.02) return;
            recent = recent.filter((time) => audio.currentTime - time < 0.03);
            if (recent.length >= TOGETHER) return;
            recent.push(audio.currentTime);
            const noise = audio.createBufferSource();
            noise.buffer = hiss!;
            const band = audio.createBiquadFilter();
            band.type = "bandpass";
            band.frequency.value = pitch;
            band.Q.value = 2.5;
            noise.connect(band).connect(fading(audio, Math.min(1, hard) * 0.5, 0.06));
            noise.start(audio.currentTime, Math.random() * 0.1, 0.07);
        },
        tone(pitch, seconds = 0.3, loud = 0.12) {
            const audio = ready();
            if (!audio) return;
            const wave = audio.createOscillator();
            wave.type = "sine";
            wave.frequency.value = pitch;
            wave.connect(fading(audio, loud, seconds));
            wave.start();
            wave.stop(audio.currentTime + seconds);
        },
        glide(from, to, seconds = 0.4, loud = 0.12) {
            const audio = ready();
            if (!audio) return;
            const wave = audio.createOscillator();
            wave.type = "sine";
            wave.frequency.setValueAtTime(from, audio.currentTime);
            wave.frequency.exponentialRampToValueAtTime(to, audio.currentTime + seconds);
            wave.connect(fading(audio, loud, seconds));
            wave.start();
            wave.stop(audio.currentTime + seconds);
        },
    };
}
