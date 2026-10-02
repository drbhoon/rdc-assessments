import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOverlaps, words, shingles, boilerplate } from './similarity.js';

// Template headings every trainee types under. Long enough to form shingles.
const TEMPLATE = `Monthly progress report for graduate engineer trainees at RDC Concrete India Limited.
Section one contributions to SARTAJ improvement during the month under review.
Section two engagement and knowledge sharing with plant team members.`;

const BODY_A = `This month I worked on reducing the batching cycle time at the Whitefield plant.
I studied the aggregate moisture probe readings every morning and corrected the water
dosage on the panel which brought the slump variation down from forty to fifteen millimetres.
I also helped the QC engineer cast cubes for the M40 pour at the metro site and recorded
the seven day strengths in the register.`;

const BODY_B = `I spent most of the month with the transit mixer fleet, tracking turnaround time
for each truck and finding that the wash bay queue added twenty minutes per trip.
After discussing with the logistics in charge we staggered the dispatch so that two trucks
never arrive at the wash bay together, and the average cycle dropped by twelve minutes.`;

const BODY_C = `My focus was the admixture stock audit. The physical count of the superplasticiser
tank did not match the ERP balance, and I traced the gap to two challans posted twice.
I raised it with the plant accountant and the entries were reversed before month end.`;

const BODY_D = `In the second half of the month I shadowed the plant in charge during customer
complaints. One builder reported low early strength on a slab; we pulled the batch tickets,
checked the cement lot and the retarder dose, and found the site had added water after
discharge. I drafted the reply letter with the cube results attached and the customer
accepted it. I also prepared the weekly preventive maintenance checklist for the twin shaft
mixer and the screw conveyors, and trained two new helpers on lockout before cleaning.`;

test('words strips punctuation and case', () => {
  assert.deepEqual(words('Hello, World!  M-40 cubes.'), ['hello', 'world', 'm', '40', 'cubes']);
});

test('shared template text alone raises no flag once enough trainees use it', () => {
  const docs = [
    { id: 1, owner: 'A', text: `${TEMPLATE}\n${BODY_A}` },
    { id: 2, owner: 'B', text: `${TEMPLATE}\n${BODY_B}` },
    { id: 3, owner: 'C', text: `${TEMPLATE}\n${BODY_C}` },
  ];
  assert.deepEqual(findOverlaps(docs, docs), []);
});

test('a copied report is flagged as COPY on both sides, HIGH when mostly copied', () => {
  const docs = [
    { id: 1, owner: 'A', text: `${TEMPLATE}\n${BODY_A}` },
    { id: 2, owner: 'B', text: `${TEMPLATE}\n${BODY_A}\nI also attended the safety meeting.` },
    { id: 3, owner: 'C', text: `${TEMPLATE}\n${BODY_C}` },
  ];
  const flags = findOverlaps(docs, docs);
  const pairs = flags.map((f) => `${f.subjectId}->${f.otherId}:${f.kind}:${f.severity}`).sort();
  assert.deepEqual(pairs, ['1->2:copy:high', '2->1:copy:high']);
  const f = flags.find((x) => x.subjectId === 2);
  assert.ok(f.share >= 80, `share ${f.share}`);
  assert.ok(f.passages[0].text.includes('aggregate moisture probe'));
});

test('a partly copied paragraph is flagged MEDIUM', () => {
  const docs = [
    { id: 1, owner: 'A', text: `${TEMPLATE}\n${BODY_A}\n${BODY_B}` },
    { id: 2, owner: 'B', text: `${TEMPLATE}\n${BODY_C}\n${BODY_D}\n${BODY_B}` },
    { id: 3, owner: 'C', text: `${TEMPLATE}\nSomething entirely different about cube testing and curing tanks at the lab.` },
  ];
  const flags = findOverlaps(docs, docs);
  const two = flags.find((x) => x.subjectId === 2 && x.otherId === 1);
  assert.ok(two, 'expected a flag on report 2');
  assert.equal(two.kind, 'copy');
  assert.equal(two.severity, 'medium');
  assert.ok(two.longestRunWords >= 40);
});

test('reusing your own earlier report is a REPEAT, not a COPY', () => {
  const corpus = [
    { id: 10, owner: 'A', text: `${TEMPLATE}\n${BODY_A}` },   // last month
    { id: 11, owner: 'A', text: `${TEMPLATE}\n${BODY_A}` },   // this month, unchanged
    { id: 12, owner: 'B', text: `${TEMPLATE}\n${BODY_B}` },
    { id: 13, owner: 'C', text: `${TEMPLATE}\n${BODY_C}` },
  ];
  const flags = findOverlaps([corpus[1]], corpus);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].otherId, 10);
  assert.equal(flags[0].kind, 'repeat');
  assert.equal(flags[0].severity, 'high');
});

test('two trainees sharing text is never treated as template', () => {
  const a = shingles(words(BODY_A));
  const common = boilerplate([{ owner: 'A', set: a.set }, { owner: 'B', set: a.set }]);
  assert.equal(common.size, 0);
});

test('an empty or unreadable report is skipped, not flagged', () => {
  const docs = [
    { id: 1, owner: 'A', text: '' },
    { id: 2, owner: 'B', text: BODY_B },
  ];
  assert.deepEqual(findOverlaps(docs, docs), []);
});
