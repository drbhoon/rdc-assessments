import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript, tally, verdictFor, reportHtml } from './scoring.js';
import { CANDIDATE_QUESTIONS_HEADING } from '../../shared/taraInterview.js';

const LONG = 'I would first stop the batching and then inform my supervisor about the problem right away';

const transcript = `CANDIDATE DETAILS:
Name: Asha Rao
Qualification: B.E.
DOB: N/A
Hometown: Pune

INTERVIEW TRANSCRIPT:

--- Q1: Why this job? ---
Candidate Answer: ${LONG}

--- Q2: Night shifts? ---
Candidate Answer: Yes I can

--- Q3: A third
question over two lines? ---
Candidate Answer: No answer provided.


${CANDIDATE_QUESTIONS_HEADING}:
When will I hear back from you about this job and the salary on offer?
`;

test('reads name, questions and answers; the candidate\'s own questions are not an answer', () => {
  const { name, questions } = parseTranscript(transcript);
  assert.equal(name, 'Asha Rao');
  assert.equal(questions.length, 3);
  assert.equal(questions[0].answer, LONG);
  assert.equal(questions[2].question, 'A third\nquestion over two lines?');
  assert.equal(questions[2].answer, '');
});

test('ten-word rule is enforced in code, whatever the model says', () => {
  const { questions } = parseTranscript(transcript);
  const judged = { answers: [{ score: 4, insight: 'ok' }, { score: 5, insight: 'great' }, { score: 5, insight: 'great' }], strengths: ['a', 'b', 'c', 'd'] };
  const r = tally('recruitment', questions, judged);
  assert.deepEqual(r.questions.map((q) => q.score), [4, 0, 0]);
  assert.equal(r.points, 4);
  assert.equal(r.max, 15);
  assert.equal(r.percent, 26.7);
  assert.equal(r.verdict, 'REJECT');
  assert.equal(r.strengths.length, 3);
});

test('a score out of range, or a missing judgement, cannot move the total off the scale', () => {
  const qs = [{ question: 'a', answer: LONG }, { question: 'b', answer: LONG }];
  const r = tally('recruitment', qs, { answers: [{ score: 99, insight: 'x' }] });
  assert.deepEqual(r.questions.map((q) => q.score), [5, 1]);
});

test('verdict bands are each track\'s own', () => {
  assert.equal(verdictFor('recruitment', 75), 'HIRE');
  assert.equal(verdictFor('recruitment', 74.9), 'BORDERLINE');
  assert.equal(verdictFor('recruitment', 65), 'BORDERLINE');
  assert.equal(verdictFor('recruitment', 64.9), 'REJECT');
  assert.equal(verdictFor('sales_recruitment', 70), 'HIRE');
  assert.equal(verdictFor('sales_recruitment', 55), 'BORDERLINE');
  assert.equal(verdictFor('sales_recruitment', 54.9), 'REJECT');
});

test('report escapes what a candidate typed', () => {
  const r = tally('recruitment', [{ question: '<b>q</b>', answer: LONG }], { answers: [{ score: 3, insight: '<script>x</script>' }], strengths: [], gaps: [], roadmap: [] });
  const html = reportHtml('recruitment', '<i>n</i>', r);
  assert.ok(!html.includes('<script>') && !html.includes('<b>q') && !html.includes('<i>n'));
  assert.ok(html.includes('3/5 pts') || html.includes('3/5'));
});
