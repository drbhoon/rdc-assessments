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

/** What she says before the first question. */
export function taraGreeting(name, count = FRESHER_QUESTIONS.length) {
  const first = speakableFirstName(name);
  return `${first ? `Hello ${first}! ` : "Hello! "}I'm Taara, and I will be your interviewer today. ` +
    `I will ask you ${count} questions, one at a time. After each question, answer in your own words, and I will write down what you say. ` +
    `When you have finished an answer, press Next Question. Let's begin.`;
}

/** What she says for question n (1-based). */
export function taraQuestion(n, question) {
  return `Question ${n}. ${question}`;
}

/** Whether TARA may say this text in an interview of this type. */
export function isTaraLine(text, assessmentType) {
  if (!TARA_INTERVIEWS.has(assessmentType) || typeof text !== "string") return false;
  if (FRESHER_QUESTIONS.some((q, i) => text === taraQuestion(i + 1, q))) return true;
  const named = /^Hello ([\p{L}][\p{L}.'-]{0,29})! /u.exec(text);
  return text === taraGreeting(named ? named[1] : "");
}
