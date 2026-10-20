import { withBase } from "../basePath";

/**
 * TARA's voice in the interview: one line at a time (a greeting or a
 * question), fetched from the server (/api/interviews/:code/tara/speak) and
 * played on one shared <audio> element, with the lips driven by the sound's
 * real loudness. Adapted from TARA Online's voice (rdc-web-chatbot,
 * src/lib/voice/voiceService.ts), keeping its lessons: one audio element
 * unlocked by the candidate's tap (phones refuse sound otherwise), a time
 * limit on every clip (a stalled clip never reports its end), and the
 * browser's own voice as a fallback.
 */

let sharedAudio: HTMLAudioElement | null = null;
let current: { stop: () => void } | null = null;

function audioElement(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = "auto";
    sharedAudio.setAttribute("playsinline", "");
  }
  return sharedAudio;
}

// A tenth of a second of silence, played inside the candidate's tap to unlock sound.
function silentWav(): string {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const write = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 36 + samples, true); write(8, "WAVE"); write(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  write(36, "data"); view.setUint32(40, samples, true); bytes.fill(128, 44);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/** Call inside the candidate's own tap (Start Interview): later lines can then play. */
export function unlockAudio(): void {
  const audio = audioElement();
  if (audio.dataset.unlocked) return;
  audio.src = silentWav();
  audio.play().then(() => { audio.dataset.unlocked = "1"; }).catch(() => { /* not this time */ });
  if ("speechSynthesis" in window) window.speechSynthesis.resume();
}

/** Loudness every 25 ms of decoded audio, for the lips; null if it cannot be decoded. */
async function loudnessEnvelope(data: ArrayBuffer): Promise<Float32Array | null> {
  try {
    const Offline = window.OfflineAudioContext || (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Offline) return null;
    const decoded = await new Offline(1, 1, 22050).decodeAudioData(data.slice(0));
    const samples = decoded.getChannelData(0);
    const step = Math.max(1, Math.round(decoded.sampleRate * 0.025));
    const out = new Float32Array(Math.ceil(samples.length / step));
    let peak = 0.0001;
    for (let i = 0; i < out.length; i++) {
      let sum = 0;
      const end = Math.min(samples.length, (i + 1) * step);
      for (let j = i * step; j < end; j++) sum += samples[j] * samples[j];
      out[i] = Math.sqrt(sum / Math.max(1, end - i * step));
      peak = Math.max(peak, out[i]);
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] / (peak * 0.7));
    return out;
  } catch {
    return null;
  }
}

export interface LineOptions {
  code: string;
  onStart?: () => void;
  /** 0..1 loudness, about 25 times a second, while she speaks. */
  onEnergy?: (energy: number) => void;
  /** Always called once: finished, failed or stopped. */
  onEnd?: () => void;
}

/** Stops whatever she is saying. */
export function stopSpeaking(): void {
  current?.stop();
  current = null;
}

/** Says one of TARA's lines. Returns a handle to stop it. */
export function speakLine(text: string, options: LineOptions): { stop: () => void } {
  stopSpeaking();
  let stopped = false;
  let ended = false;
  let timer: number | null = null;
  let guard: number | null = null;
  const audio = audioElement();

  const end = () => {
    if (ended) return;
    ended = true;
    if (timer !== null) window.clearInterval(timer);
    if (guard !== null) window.clearTimeout(guard);
    audio.onended = audio.onerror = null;
    options.onEnergy?.(0);
    if (handle === current) current = null;
    options.onEnd?.();
  };
  const handle = {
    stop: () => {
      if (stopped) return;
      stopped = true;
      audio.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      end();
    },
  };
  current = handle;

  const browserVoice = () => {
    if (stopped) return;
    if (!("speechSynthesis" in window)) return end();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 0.95;
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.replace("_", "-").startsWith("en-IN"));
    if (voices[0]) utterance.voice = voices[0];
    utterance.onstart = () => {
      options.onStart?.();
      timer = window.setInterval(() => options.onEnergy?.(0.25 + Math.random() * 0.6), 105);
    };
    utterance.onend = utterance.onerror = end;
    guard = window.setTimeout(end, (text.length / 10 + 5) * 1000);
    window.speechSynthesis.speak(utterance);
  };

  void (async () => {
    let data: ArrayBuffer;
    try {
      const res = await fetch(withBase(`/api/interviews/${encodeURIComponent(options.code)}/tara/speak`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`voice ${res.status}`);
      data = await res.arrayBuffer();
    } catch (error) {
      console.warn("TARA's voice unavailable; using the browser voice.", error);
      return browserVoice();
    }
    if (stopped) return;
    const envelope = await loudnessEnvelope(data);
    if (stopped) return;
    const url = URL.createObjectURL(new Blob([data], { type: "audio/mpeg" }));
    audio.onended = () => { URL.revokeObjectURL(url); end(); };
    audio.onerror = () => { URL.revokeObjectURL(url); end(); };
    audio.src = url;
    try {
      await audio.play();
    } catch {
      URL.revokeObjectURL(url);
      return browserVoice();
    }
    options.onStart?.();
    timer = window.setInterval(() => {
      const at = audio.currentTime;
      options.onEnergy?.(envelope ? envelope[Math.min(envelope.length - 1, Math.floor(at / 0.025))] : 0.25 + Math.random() * 0.6);
    }, 40);
    const seconds = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : text.length / 12;
    guard = window.setTimeout(end, (seconds + 4) * 1000);
  })();

  return handle;
}
