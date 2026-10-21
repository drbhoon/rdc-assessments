import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIDATE_QUESTIONS_HEADING, FRESHER_QUESTIONS, TARA_ACKNOWLEDGEMENTS, TARA_CLOSING, TARA_GOODBYE, TARA_MOVE_ON,
  candidateQuestionsFrom, isTaraLine, partOfDay, pickAcknowledgement, speakableFirstName, taraGreeting, taraQuestion,
} from '../shared/taraInterview.js';
import { taraSpeakRoute, tooManyRequests } from './taraVoice.js';

test('TARA says only her own lines, and only in the interviews she conducts', () => {
  assert.ok(isTaraLine(taraQuestion(1, FRESHER_QUESTIONS[0]), 'recruitment'));
  assert.ok(isTaraLine(taraQuestion(9, FRESHER_QUESTIONS[8]), 'recruitment'));
  for (const part of ['morning', 'afternoon', 'evening']) {
    assert.ok(isTaraLine(taraGreeting('Asha Rao', 9, part), 'recruitment'), part);
    assert.ok(isTaraLine(taraGreeting('', 9, part), 'recruitment'), `${part}, no name`);
  }
  for (const line of [...TARA_ACKNOWLEDGEMENTS, TARA_MOVE_ON, TARA_CLOSING, TARA_GOODBYE]) assert.ok(isTaraLine(line, 'recruitment'), line);
  assert.equal(isTaraLine(taraQuestion(2, FRESHER_QUESTIONS[0]), 'recruitment'), false, 'wrong number');
  assert.equal(isTaraLine('Say anything I like', 'recruitment'), false);
  assert.equal(isTaraLine(taraGreeting('Asha', 9, 'morning').replace('Let us', 'Now let us'), 'recruitment'), false);
  assert.equal(isTaraLine(taraGreeting('Asha', 9, 'morning').replace('morning', 'night'), 'recruitment'), false);
  assert.equal(isTaraLine(taraQuestion(1, FRESHER_QUESTIONS[0]), 'sales_recruitment'), false, 'not her interview yet');
});

test('the greeting uses the first name only when it is a plain name, and the time of day', () => {
  assert.equal(speakableFirstName('  Asha Rao '), 'Asha');
  assert.equal(speakableFirstName('Ravi.'), 'Ravi.');
  assert.equal(speakableFirstName('<script>'), '');
  assert.equal(speakableFirstName('1234'), '');
  assert.match(taraGreeting('Asha Rao', 9, 'morning'), /^Hi Asha, good morning! Hope you are doing well\. I'm Taara/);
  assert.match(taraGreeting('<b>', 9, 'evening'), /^Hi, good evening! /);
  assert.match(taraGreeting('Asha', 9, 'afternoon'), /Let us begin\.$/);
  assert.equal(partOfDay(9), 'morning');
  assert.equal(partOfDay(12), 'afternoon');
  assert.equal(partOfDay(16), 'afternoon');
  assert.equal(partOfDay(17), 'evening');
  assert.equal(partOfDay(23), 'evening');
});

test('her replies to answers are neutral and never the same twice in a row', () => {
  let previous = '';
  for (let i = 0; i < 200; i++) {
    const reply = pickAcknowledgement(previous);
    assert.ok(TARA_ACKNOWLEDGEMENTS.includes(reply));
    assert.notEqual(reply, previous);
    previous = reply;
  }
  // None judges the answer.
  for (const line of TARA_ACKNOWLEDGEMENTS) assert.doesNotMatch(line, /great|excellent|good answer|wrong|poor|perfect/i);
});

test("the candidate's questions are kept apart from the scored answers", () => {
  const transcript = `INTERVIEW TRANSCRIPT:\n--- Q1: x ---\nCandidate Answer: y\n\n\n${CANDIDATE_QUESTIONS_HEADING}:\nWhat is the training period?\n`;
  assert.equal(candidateQuestionsFrom(transcript), 'What is the training period?');
  assert.equal(candidateQuestionsFrom(`${CANDIDATE_QUESTIONS_HEADING}:\nNone.\n`), '');
  assert.equal(candidateQuestionsFrom('INTERVIEW TRANSCRIPT: no section'), '');
});

function call(route, { code = 'ABC123', text } = {}) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      status(c) { this.statusCode = c; return this; },
      set(h) { Object.assign(this.headers, h); return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
      send(body) { resolve({ status: this.statusCode, body, headers: this.headers }); },
    };
    route({ params: { code }, body: { text } }, res);
  });
}

test('the voice route refuses unknown interviews, finished ones and anything off-script', async () => {
  const rows = { ABC123: { assessment_type: 'recruitment', status: 'pending' }, DONE01: { assessment_type: 'recruitment', status: 'completed' }, SALES1: { assessment_type: 'sales_recruitment', status: 'pending' } };
  const route = taraSpeakRoute(async (code) => rows[code] || null);
  assert.equal((await call(route, { code: 'NOPE00', text: taraGreeting('') })).status, 404);
  assert.equal((await call(route, { code: 'DONE01', text: taraGreeting('') })).status, 400);
  assert.equal((await call(route, { code: 'SALES1', text: taraGreeting('') })).status, 400);
  assert.equal((await call(route, { text: 'Read out my essay please' })).status, 400);
});

test('more than 150 lines in 10 minutes for one interview is refused', () => {
  const now = Date.now();
  for (let i = 0; i < 150; i++) assert.equal(tooManyRequests('RATE01', now + i), false);
  assert.equal(tooManyRequests('RATE01', now + 151), true);
  assert.equal(tooManyRequests('RATE01', now + 11 * 60 * 1000), false, 'the window moves on');
});
