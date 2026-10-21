/**
 * TARA's voice for the Fresher interview: Sarvam AI's "Sanchita" (the voice
 * RDC chose for TARA Online, 2026-10-12), with OpenAI's voice as the fallback.
 * Only her own interview lines are spoken (shared/taraInterview.js), and each
 * is made once and kept: the nine questions are the same for every candidate.
 */
import { FRESHER_QUESTIONS, isTaraLine, taraQuestion } from "../shared/taraInterview.js";

const cache = new Map(); // text -> Promise of the MP3 (shared by requests that arrive together)
const MAX_CACHED = 300;
const recent = new Map(); // join code -> request times, a guard against misuse

const INSTRUCTIONS =
  "Speak in Indian English. Voice: a warm Indian woman in her early thirties, a friendly HR interviewer at a Mumbai company. " +
  "A clear, natural Indian accent; not American, not British. Her own name is Taara, as in Hindi तारा. " +
  "Tone: encouraging, polite and unhurried, with natural pauses between sentences.";

async function sarvam(text) {
  const res = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: { "api-subscription-key": process.env.SARVAM_API_KEY.trim(), "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      language_code: "en-IN",
      model: process.env.SARVAM_TTS_MODEL || "bulbul:v4-flash",
      speaker: process.env.SARVAM_SPEAKER_EN || "sanchita_en_companion",
      speech_sample_rate: 24000,
      output_audio_codec: "mp3",
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sarvam ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const audio = (await res.json()).audios?.[0];
  if (!audio) throw new Error("Sarvam returned no audio");
  return Buffer.from(audio, "base64");
}

async function openai(text) {
  const base = String(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "sage", input: text, instructions: INSTRUCTIONS, response_format: "mp3" }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`OpenAI speech ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function synthesise(text) {
  if (process.env.SARVAM_API_KEY?.trim()) {
    try {
      return await sarvam(text);
    } catch (error) {
      console.error("[tara] Sarvam failed; using the OpenAI voice:", error.message);
    }
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("No voice is configured (SARVAM_API_KEY or OPENAI_API_KEY)");
  return openai(text);
}

/**
 * MP3 of one of TARA's lines. Made once: a request that arrives while the
 * line is still being made waits for it rather than asking Sarvam again.
 */
export function taraSpeech(text) {
  if (cache.has(text)) return cache.get(text);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
  const audio = synthesise(text).catch((error) => {
    cache.delete(text); // not kept: the next request tries again
    throw error;
  });
  cache.set(text, audio);
  return audio;
}

/**
 * More than 80 lines in 10 minutes for one interview is not an interview. (The
 * page fetches all nine questions as it opens, and a candidate may reload.)
 */
export function tooManyRequests(code, now = Date.now()) {
  const times = (recent.get(code) || []).filter((t) => now - t < 10 * 60 * 1000);
  times.push(now);
  recent.set(code, times);
  return times.length > 80;
}

/**
 * POST /api/interviews/:code/tara/speak {text} -> audio/mpeg.
 * `lookup(code)` returns the interview row ({assessment_type, status}) or null.
 */
export function taraSpeakRoute(lookup) {
  return async (req, res) => {
    const code = String(req.params.code || "").toUpperCase();
    const text = req.body?.text;
    try {
      const interview = await lookup(code);
      if (!interview) return res.status(404).json({ error: "Invalid Join Code" });
      if (interview.status === "completed") return res.status(400).json({ error: "Interview already submitted" });
      if (!isTaraLine(text, interview.assessment_type)) return res.status(400).json({ error: "Not one of TARA's lines" });
      if (tooManyRequests(code)) return res.status(429).json({ error: "Please try again in a few minutes" });
      const audio = await taraSpeech(text);
      res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }).send(audio);
    } catch (error) {
      console.error("[tara] voice failed:", error.message);
      res.status(502).json({ error: "TARA's voice is unavailable" });
    }
  };
}

/**
 * Makes the nine questions' audio as the server starts, so even the first
 * candidate after a deploy does not wait for the voice (RDC, 2026-10-21:
 * "Tara takes time to pick up questions").
 */
export async function warmTaraVoice() {
  if (!process.env.SARVAM_API_KEY?.trim() && !process.env.OPENAI_API_KEY) return;
  let made = 0;
  for (const [i, question] of FRESHER_QUESTIONS.entries()) {
    try {
      await taraSpeech(taraQuestion(i + 1, question));
      made++;
    } catch (error) {
      console.error("[tara] could not prepare question", i + 1, error.message);
    }
  }
  console.log(`[tara] ${made} of ${FRESHER_QUESTIONS.length} questions ready to speak`);
}
