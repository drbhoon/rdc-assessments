import test from 'node:test';
import assert from 'node:assert/strict';
import { FRESHER_QUESTIONS, isTaraLine, speakableFirstName, taraGreeting, taraQuestion } from '../shared/taraInterview.js';
import { taraSpeakRoute, tooManyRequests } from './taraVoice.js';

test('TARA says only her own lines, and only in the interviews she conducts', () => {
  assert.ok(isTaraLine(taraQuestion(1, FRESHER_QUESTIONS[0]), 'recruitment'));
  assert.ok(isTaraLine(taraQuestion(9, FRESHER_QUESTIONS[8]), 'recruitment'));
  assert.ok(isTaraLine(taraGreeting('Asha Rao'), 'recruitment'));
  assert.ok(isTaraLine(taraGreeting(''), 'recruitment'));
  assert.equal(isTaraLine(taraQuestion(2, FRESHER_QUESTIONS[0]), 'recruitment'), false, 'wrong number');
  assert.equal(isTaraLine('Say anything I like', 'recruitment'), false);
  assert.equal(isTaraLine(taraGreeting('Asha').replace('Let', 'Now let'), 'recruitment'), false);
  assert.equal(isTaraLine(taraQuestion(1, FRESHER_QUESTIONS[0]), 'sales_recruitment'), false, 'not her interview yet');
});

test('the greeting uses the first name only when it is a plain name', () => {
  assert.equal(speakableFirstName('  Asha Rao '), 'Asha');
  assert.equal(speakableFirstName('Ravi.'), 'Ravi.');
  assert.equal(speakableFirstName('<script>'), '');
  assert.equal(speakableFirstName('1234'), '');
  assert.match(taraGreeting('Asha Rao'), /^Hello Asha! I'm Taara/);
  assert.match(taraGreeting('<b>'), /^Hello! I'm Taara/);
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

test('more than 80 lines in 10 minutes for one interview is refused', () => {
  const now = Date.now();
  for (let i = 0; i < 80; i++) assert.equal(tooManyRequests('RATE01', now + i), false);
  assert.equal(tooManyRequests('RATE01', now + 81), true);
  assert.equal(tooManyRequests('RATE01', now + 11 * 60 * 1000), false, 'the window moves on');
});
