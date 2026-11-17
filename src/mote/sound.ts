// Mote's sound: short knocks and tones made by the browser itself, with no files. It is silent until
// the visitor turns it on with the button this gives, and stays as they left it between visits.
//
//   const sound = sounds(m);
//   panel.append(sound.button);
//   sound.knock(0.6, 900);      // how hard, from 0 to 1, and how high, in hertz
//   sound.tone(660, 0.25);      // a clear note, and how long it rings
//   sound.glide(180, 40, 0.9);  // a note that slides from one pitch to another as it dies away
//   sound.strike("chime", 0.7, 784);   // a marble striking something: what, how hard, and its note
//   const hiss = sound.bed(6000);      // noise that lasts: water on lava, a fire, grains pouring
//   hiss.feed(0.4);                    // how loud it is now; asked every frame, and it dies away when it is not
//
// A strike is made of plain waves, each with a volume that rises at once and dies away, and a little
// filtered noise for the moment of the hit; `voice` builds one into any of the browser's audio
// contexts, so the same code is heard live and can be rendered to a file. Every strike goes through
// one bus with a limit on how many sound at once (`VOICES`): a new one past the limit takes the place
// of the quietest one sounding, fading it in a hundredth of a second, or is left out if it would be
// the quietest itself, and the bus ends in a limiter, so that a hundred marbles never clip.

import type { Mote } from "./stage";

/** What a marble strikes: wood, another marble, metal, a chime bar, a bell or a drum. */
export type Strike = "wood" | "glass" | "metal" | "chime" | "bell" | "drum";

export interface Sounds {
    /** A short dry knock: one thing hitting another. */
    knock(hard: number, pitch?: number): void;
    /** A clear note that dies away. */
    tone(pitch: number, seconds?: number, loud?: number): void;
    /** A note that slides from one pitch to another while it dies away: a swoop up, or a fall. */
    glide(from: number, to: number, seconds?: number, loud?: number): void;
    /** A marble striking something, `hard` from 0 to 1; `pitch` is a chime bar's note, or shifts the others' pitch by that share of their own (1 as made). */
    strike(kind: Strike, hard: number, pitch?: number): void;
    /** Noise that lasts, about `pitch` hertz and as narrow as `q` is high: a hiss, a roar, a pour. Nothing is made until it is first fed. */
    bed(pitch: number, q?: number): Bed;
    /** How many strikes are sounding now, and how many were left out or cut short for want of room: for measuring. */
    readonly sounding: { now: number; dropped: number; made: number };
    /** Turns the sound on and off. */
    readonly button: HTMLButtonElement;
}

/** Noise that sounds for as long as it is fed: nothing sounds by itself. */
export interface Bed {
    /** How loud it is now, from 0 to 1, and its pitch if that has changed. Fed every frame it holds; left alone for a fifth of a second it dies away. */
    feed(loud: number, pitch?: number): void;
}

/** How long a bed holds after it was last fed, and how quickly it then dies, in seconds. */
const HELD = { for: 0.2, dies: 0.08, comes: 0.04 };

/** At most this many knocks start in any one stretch of 30 ms: a pile of things landing together is one noise, not forty. */
const TOGETHER = 4;
/** At most this many strikes sound at once. */
export const VOICES = 14;
/** At most this many clicks of wood or glass start in any one stretch of 30 ms. */
const CLICKS = 6;

/** One wave of a strike: its pitch, as a share of the strike's own for the inharmonic ones, how loud, and how quickly it dies, as the time it takes to fall to a third. */
interface Partial {
    at: number;
    loud: number;
    dies: number;
}

/**
 * The make-up of each strike. A chime bar's waves are those of a bar free at both ends (1, 2.756 and
 * 5.404 times its note), the upper ones dying quickly and louder for a harder strike; a bell's are a
 * small bell's (a hum an octave below, the prime, a minor third, a fifth, the bright nominal an octave
 * up and three above it); a drum is a low wave falling in pitch with a little dull noise; wood is a
 * burst of noise about 2.4 kHz with a short wave under it; glass on glass two high waves that die in
 * hundredths of a second; metal four inharmonic waves that ring for a few tenths.
 */
const MAKE_UP: Record<Strike, { pitch: number; waves: Partial[]; noise?: { at: number; q: number; loud: number; dies: number; low?: boolean }; loud: number; attack: number }> = {
    wood: { pitch: 1250, waves: [{ at: 1, loud: 0.45, dies: 0.012 }, { at: 2.48, loud: 0.18, dies: 0.008 }], noise: { at: 2400, q: 3, loud: 1, dies: 0.011 }, loud: 0.34, attack: 0.0006 },
    glass: { pitch: 3950, waves: [{ at: 1, loud: 1, dies: 0.022 }, { at: 1.55, loud: 0.5, dies: 0.013 }], noise: { at: 6500, q: 1.5, loud: 0.3, dies: 0.003 }, loud: 0.2, attack: 0.0004 },
    metal: { pitch: 1800, waves: [{ at: 1, loud: 1, dies: 0.12 }, { at: 1.51, loud: 0.6, dies: 0.085 }, { at: 2.36, loud: 0.35, dies: 0.055 }, { at: 3.12, loud: 0.2, dies: 0.035 }], noise: { at: 5000, q: 2, loud: 0.25, dies: 0.002 }, loud: 0.17, attack: 0.0008 },
    chime: { pitch: 784, waves: [{ at: 1, loud: 1, dies: 0.55 }, { at: 2.756, loud: 0.3, dies: 0.12 }, { at: 5.404, loud: 0.1, dies: 0.04 }], noise: { at: 4200, q: 2, loud: 0.12, dies: 0.002 }, loud: 0.22, attack: 0.0015 },
    bell: { pitch: 1047, waves: [{ at: 0.5, loud: 0.3, dies: 0.7 }, { at: 1, loud: 0.6, dies: 0.5 }, { at: 1.2, loud: 0.45, dies: 0.4 }, { at: 1.5, loud: 0.22, dies: 0.3 }, { at: 2, loud: 1, dies: 0.38 }, { at: 2.5, loud: 0.35, dies: 0.2 }, { at: 2.67, loud: 0.28, dies: 0.17 }, { at: 3, loud: 0.22, dies: 0.12 }], noise: { at: 6000, q: 2, loud: 0.1, dies: 0.002 }, loud: 0.12, attack: 0.001 },
    drum: { pitch: 150, waves: [{ at: 1, loud: 1, dies: 0.07 }, { at: 1.59, loud: 0.3, dies: 0.035 }], noise: { at: 700, q: 0.7, loud: 0.35, dies: 0.012, low: true }, loud: 0.5, attack: 0.003 },
};

/** How a strike's waves are set by how hard it is: louder by the hardness to the power 0.7, as loudness is heard, and a touch higher, up to 12% for a click and 4% for a drum; a tuned note keeps its pitch and grows brighter instead. */
export function shaped(kind: Strike, hard: number, pitch?: number): { pitch: number; loud: number; bright: number } {
    const k = Math.max(0, Math.min(1, hard));
    const made = MAKE_UP[kind];
    const tuned = kind === "chime";
    const base = tuned ? pitch ?? made.pitch : made.pitch * (pitch ?? 1);
    const rise = kind === "wood" || kind === "glass" ? 0.12 : kind === "drum" ? 0.04 : kind === "metal" ? 0.05 : 0;
    return { pitch: base * (1 + rise * k), loud: made.loud * (0.15 + 0.85 * k ** 0.7), bright: k };
}

/**
 * Builds one strike into an audio context, starting at `at` seconds of its clock, into `out`: a
 * volume of its own (`gain`, to fade it early) over its waves and its noise. `noise` is a short buffer
 * of white noise. Gives back the volume and when it has died away.
 */
export function voice(audio: BaseAudioContext, out: AudioNode, at: number, kind: Strike, hard: number, noise: AudioBuffer, pitch?: number): { gain: GainNode; ends: number; loud: number; dies: number } {
    const made = MAKE_UP[kind];
    const { pitch: f, loud, bright } = shaped(kind, hard, pitch);
    const gain = audio.createGain();
    gain.gain.value = loud;
    gain.connect(out);
    let ends = at;
    const nyquist = audio.sampleRate / 2;
    made.waves.forEach((wave, i) => {
        const freq = f * wave.at;
        if (freq >= nyquist * 0.9) return;
        // a chime's upper waves come up with a harder strike; a low note rings longer than a high one
        const amount = kind === "chime" && i > 0 ? wave.loud * (0.4 + 1.2 * bright) : wave.loud;
        const dies = kind === "chime" && i === 0 ? wave.dies * (784 / f) ** 0.35 : wave.dies;
        const osc = audio.createOscillator();
        osc.type = "sine";
        if (kind === "drum") {
            // a drum's skin falls in pitch as it settles: from a little above its note to two thirds of it
            osc.frequency.setValueAtTime(freq * 1.25, at);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.62, at + 0.09);
        } else osc.frequency.value = freq;
        const env = audio.createGain();
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(amount, at + made.attack);
        env.gain.setTargetAtTime(0, at + made.attack, dies);
        osc.connect(env).connect(gain);
        const stop = at + made.attack + dies * 7;
        osc.start(at);
        osc.stop(stop);
        ends = Math.max(ends, stop);
    });
    if (made.noise) {
        const n = made.noise;
        const source = audio.createBufferSource();
        source.buffer = noise;
        const filter = audio.createBiquadFilter();
        filter.type = n.low ? "lowpass" : "bandpass";
        filter.frequency.value = Math.min(nyquist * 0.9, n.at * (kind === "wood" ? f / made.pitch : 1));
        filter.Q.value = n.q;
        const env = audio.createGain();
        env.gain.setValueAtTime(0, at);
        env.gain.linearRampToValueAtTime(n.loud * (kind === "wood" ? 1 : 0.5 + bright), at + made.attack);
        env.gain.setTargetAtTime(0, at + made.attack, n.dies);
        source.connect(filter).connect(env).connect(gain);
        const stop = at + made.attack + n.dies * 8;
        source.start(at, 0, Math.min(noise.duration, stop - at));
        ends = Math.max(ends, stop);
    }
    const longest = Math.max(...made.waves.map((wave) => wave.dies));
    return { gain, ends, loud, dies: longest };
}

/** A short buffer of white noise, the same each time for a given seed, that a strike's noise is a filtered piece of; two seconds of it go round and round in a bed. */
export function hissOf(audio: BaseAudioContext, seed = 7, seconds = 0.25): AudioBuffer {
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * seconds), audio.sampleRate);
    const samples = buffer.getChannelData(0);
    let state = seed >>> 0;
    for (let i = 0; i < samples.length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        samples[i] = (state / 2 ** 32) * 2 - 1;
    }
    return buffer;
}

/**
 * A bed built into any of the browser's audio contexts: `noise` going round, through a filter about
 * `pitch`, at a volume that is nothing until it is fed. Each feeding at `time` brings the volume toward
 * `loud` and sets it to die away a fifth of a second later, which the next feeding puts off: so a bed
 * that is no longer fed (the scene paused, the tab hidden, the sound switched off) falls silent.
 */
export function bedOf(audio: BaseAudioContext, out: AudioNode, noise: AudioBuffer, pitch: number, q = 0.7): { feed(loud: number, time: number, pitch?: number): void } {
    const source = audio.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const band = audio.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = pitch;
    band.Q.value = q;
    const volume = audio.createGain();
    volume.gain.value = 0;
    source.connect(band).connect(volume).connect(out);
    source.start();
    return {
        feed(loud, time, at) {
            volume.gain.cancelScheduledValues(time);
            volume.gain.setTargetAtTime(Math.max(0, Math.min(1, loud)), time, HELD.comes);
            volume.gain.setTargetAtTime(0, time + HELD.for, HELD.dies);
            if (at !== undefined) band.frequency.setTargetAtTime(at, time, HELD.comes);
        },
    };
}

/** The bus every strike goes through: a volume, then a limiter that holds the loudest moments under full scale. */
export function busOf(audio: BaseAudioContext): AudioNode {
    const volume = audio.createGain();
    volume.gain.value = 0.6;
    const limit = audio.createDynamicsCompressor();
    limit.threshold.value = -9;
    limit.knee.value = 4;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.15;
    volume.connect(limit).connect(audio.destination);
    return volume;
}

/** The strikes sounding on a bus, and a rule for room: a new one past `most` takes the place of the quietest now, unless it would be the quietest itself. */
export function voices(most = VOICES) {
    const live: { gain: GainNode; ends: number; loud: number; dies: number; start: number }[] = [];
    const counts = { now: 0, dropped: 0, made: 0 };
    /** How loud a strike is at a moment, from how loud it began and how quickly its longest wave dies. */
    const now = (one: (typeof live)[number], time: number) => one.loud * Math.exp(-(time - one.start) / one.dies);
    return {
        counts,
        /** Whether a strike this loud may start at `time`; if room had to be made, the quietest is faded away. */
        room(time: number, loud: number): boolean {
            for (let i = live.length - 1; i >= 0; i--) if (live[i]!.ends <= time) live.splice(i, 1);
            counts.now = live.length;
            if (live.length < most) return true;
            let quietest = 0;
            for (let i = 1; i < live.length; i++) if (now(live[i]!, time) < now(live[quietest]!, time)) quietest = i;
            if (now(live[quietest]!, time) >= loud) {
                counts.dropped++;
                return false;
            }
            const gone = live.splice(quietest, 1)[0]!;
            gone.gain.gain.cancelScheduledValues(time);
            gone.gain.gain.setValueAtTime(gone.gain.gain.value, time);
            gone.gain.gain.linearRampToValueAtTime(0, time + 0.01);
            counts.dropped++;
            return true;
        },
        add(one: { gain: GainNode; ends: number; loud: number; dies: number }, start: number) {
            live.push({ ...one, start });
            counts.made++;
            counts.now = live.length;
        },
        live,
    };
}

export function sounds(m: Pick<Mote, "recall" | "keep">): Sounds {
    let on = m.recall("sound", false);
    let out: AudioContext | undefined;
    let hiss: AudioBuffer | undefined;
    let bus: AudioNode | undefined;
    let strikeNoise: AudioBuffer | undefined;
    let bedNoise: AudioBuffer | undefined;
    let recent: number[] = [];
    let clicks: number[] = [];
    const room = voices();

    const button = document.createElement("button");
    button.type = "button";
    button.className = "quiet";
    // the wider of its two words, for a line that keeps a word's room so that nothing after it moves when it changes
    button.dataset.widest = "sound: off";
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
        sounding: room.counts,
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
        strike(kind, hard, pitch) {
            const audio = ready();
            if (!audio || hard < 0.03) return;
            const time = audio.currentTime;
            if (kind === "wood" || kind === "glass") {
                clicks = clicks.filter((when) => time - when < 0.03);
                if (clicks.length >= CLICKS) return;
                clicks.push(time);
            }
            const { loud } = shaped(kind, hard, pitch);
            if (!room.room(time, loud)) return;
            bus ??= busOf(audio);
            strikeNoise ??= hissOf(audio, Math.floor(Math.random() * 2 ** 31));
            const made = voice(audio, bus, time, kind, hard, strikeNoise, pitch);
            room.add(made, time);
        },
        bed(pitch, q) {
            let made: ReturnType<typeof bedOf> | undefined;
            return {
                feed(loud, at) {
                    const audio = ready();
                    // nothing is made for a bed that has not yet sounded
                    if (!audio || (!made && loud <= 0)) return;
                    bus ??= busOf(audio);
                    bedNoise ??= hissOf(audio, Math.floor(Math.random() * 2 ** 31), 2);
                    made ??= bedOf(audio, bus, bedNoise, pitch, q);
                    made.feed(loud, audio.currentTime, at);
                },
            };
        },
    };
}
