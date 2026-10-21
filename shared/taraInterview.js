/**
 * TARA, the interviewer in the Fresher assessment's spoken part (Part B):
 * the questions and everything she says. Shared by the candidate page and by
 * the server's voice route, which speaks these lines and nothing else — so
 * the route cannot be used as a free text-to-speech service.
 *
 * Her name is written TARA but said "Taara" (as in Hindi तारा), as RDC's
 * TARA Online says it; the spoken lines spell it that way.
 */

export const FRESHER_QUESTIONS = [
  "What are your short term and long term goals?",
  "Ready mix concrete plants are located pan-India. Are you ready to relocate anywhere in India?",
  "Why do you need this job? What is your motivation?",
  "In this industry, 24-hour continuous pours happen. Are you willing to work a 24-hour shift if an emergency requires it?",
  "Tell me about your family background. What do your parents do, and what responsibilities do you have at home?",
  "If you are assigned a task at 6 PM and told it must be completed by 6 AM, how would you ensure it gets done?",
  "The RMC industry is physically demanding and peak hours can be 12 hours long. How comfortable are you with this?",
  "What have you been doing during the gap since your exams finished?",
  "Walk me through your typical daily schedule, from the time you wake up until you go to sleep. What do you do on weekends?",
];

/** Assessment types TARA interviews for (the pilot: Fresher, 2026-10-20). */
export const TARA_INTERVIEWS = new Set(["recruitment"]);

/** The candidate's first name as she may say it, or "" when it is not a plain name. */
export function speakableFirstName(name) {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return /^[\p{L}][\p{L}.'-]{0,29}$/u.test(first) ? first : "";
}

/** "morning", "afternoon" or "evening" at this hour (the candidate's own clock). */
export function partOfDay(hour = new Date().getHours()) {
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

/** What she says before the first question (RDC, 2026-10-21: by the time of day). */
export function taraGreeting(name, count = FRESHER_QUESTIONS.length, part = partOfDay()) {
  const first = speakableFirstName(name);
  return `Hi${first ? ` ${first}` : ""}, good ${part}! Hope you are doing well. I'm Taara, and I will be your interviewer today. ` +
    `I will ask you ${count} questions, one at a time. Answer each in your own words, and press Next Question when you have finished. ` +
    `Let us begin.`;
}

/** What she says for question n (1-based). */
export function taraQuestion(n, question) {
  return `Question ${n}. ${question}`;
}

/**
 * Short replies after an answer, so the interview is not one-sided (RDC,
 * 2026-10-21). Deliberately neutral: they never hint whether an answer was
 * good, so every candidate hears the same kind of response.
 */
export const TARA_ACKNOWLEDGEMENTS = [
  "Oh, I see.",
  "Thank you for sharing that.",
  "Understood.",
  "Okay, noted.",
  "I see, thank you.",
  "Alright, thank you.",
  "That's helpful to know.",
];

/** After a question left unanswered. */
export const TARA_MOVE_ON = "Alright, let's move on.";

/** One of the acknowledgements, never the same as the last one. */
export function pickAcknowledgement(previous, random = Math.random) {
  const choices = TARA_ACKNOWLEDGEMENTS.filter((line) => line !== previous);
  return choices[Math.floor(random() * choices.length)];
}

/** After the last question (RDC's words, 2026-10-21); then she listens for the candidate's questions. */
export const TARA_CLOSING =
  "Thank you for joining us for this conversation. The HR team will review your responses and get back to you within 24 hours. " +
  "If you have any questions, you can ask them now. I will record them and share them with the RDC team.";

/** When the candidate finishes. */
export const TARA_GOODBYE = "Thank you. Your interview is complete. All the best!";

/** Every line that is the same for all candidates: made once and kept ready. */
export const TARA_FIXED_LINES = [
  ...FRESHER_QUESTIONS.map((q, i) => taraQuestion(i + 1, q)),
  ...TARA_ACKNOWLEDGEMENTS,
  TARA_MOVE_ON,
  TARA_CLOSING,
  TARA_GOODBYE,
];

/** Whether TARA may say this text in an interview of this type. */
export function isTaraLine(text, assessmentType) {
  if (!TARA_INTERVIEWS.has(assessmentType) || typeof text !== "string") return false;
  if (TARA_FIXED_LINES.includes(text)) return true;
  const greeting = /^Hi(?: ([\p{L}][\p{L}.'-]{0,29}))?, good (morning|afternoon|evening)! /u.exec(text);
  return Boolean(greeting) && text === taraGreeting(greeting[1] || "", FRESHER_QUESTIONS.length, greeting[2]);
}

/**
 * The candidate's own questions at the end, kept in the transcript under this
 * heading so HR sees them; the scoring is told to leave them out.
 */
export const CANDIDATE_QUESTIONS_HEADING = "CANDIDATE'S QUESTIONS FOR RDC (not part of the assessment; do not score)";

/** The candidate's questions from a transcript, or "" when there are none. */
export function candidateQuestionsFrom(transcript) {
  const at = String(transcript || "").indexOf(CANDIDATE_QUESTIONS_HEADING);
  if (at < 0) return "";
  const text = transcript.slice(at + CANDIDATE_QUESTIONS_HEADING.length).replace(/^[:\s]+/, "").trim();
  return text === "None." ? "" : text;
}
