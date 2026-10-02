/**
 * Copy and repeat detection for monthly trainee reports.
 *
 * Deterministic on purpose: the same two reports always give the same overlap,
 * so a flag can be explained ("62% of this report appears in Ravi's") and
 * re-checked. The AI is used afterwards only to judge whether an overlap that
 * crossed the threshold is genuine copying or shared template text.
 *
 * Method: each report becomes a set of overlapping 7-word runs ("shingles").
 * Two reports share a shingle only when seven consecutive words match, which
 * ordinary phrasing almost never does by chance, while a copied or recycled
 * paragraph shares dozens.
 *
 * Template text — the form's own headings and instructions, which every
 * trainee types under — is removed first: any shingle that appears in the
 * reports of many different trainees is treated as boilerplate. With only a
 * handful of trainees that rule cannot tell a template from a copying ring,
 * which is why every flag is still put to the AI before HR sees it.
 */

export const SHINGLE_WORDS = 7;

/** A report must share at least this share of its own content to be flagged… */
export const FLAG_SHARE = 0.2;
/** …or contain one unbroken copied run at least this many words long. */
export const FLAG_RUN_WORDS = 40;
/** At or above this share the flag is HIGH rather than MEDIUM. */
export const HIGH_SHARE = 0.5;
/** Below this many content shingles a percentage means little; only runs count. */
const MIN_CONTENT_SHINGLES = 30;

/** Lower-case words, punctuation and layout removed. */
export function words(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents and vowel signs, so spelling variants still match
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * The shingles of a word list, with the word position each one starts at.
 * Returns { list: [shingle…] in order, set: Set<shingle> }.
 */
export function shingles(wordList, size = SHINGLE_WORDS) {
  const list = [];
  for (let i = 0; i + size <= wordList.length; i++) {
    list.push(wordList.slice(i, i + size).join(' '));
  }
  return { list, set: new Set(list) };
}

/**
 * Shingles common enough across DIFFERENT trainees to be template text.
 *
 * @param docs [{ owner, set }] — owner is whatever identifies the trainee
 * @returns Set<shingle>
 */
export function boilerplate(docs) {
  const owners = new Map(); // shingle -> Set(owner)
  const everyone = new Set();
  for (const { owner, set } of docs) {
    everyone.add(owner);
    for (const s of set) {
      let o = owners.get(s);
      if (!o) owners.set(s, (o = new Set()));
      o.add(owner);
    }
  }
  // Half the trainees, and never fewer than three: two people sharing text is
  // the very thing being looked for, so it can never count as "template".
  const threshold = Math.max(3, Math.ceil(everyone.size * 0.5));
  const common = new Set();
  for (const [s, o] of owners) if (o.size >= threshold) common.add(s);
  return common;
}

/**
 * How much of `subject` appears in `other`.
 *
 * @param subject { list, set } shingles of the report being checked
 * @param other   { set }       shingles of the report it is compared with
 * @param common  Set           boilerplate to ignore
 * @param subjectWords string[] the subject's words, to quote the passages
 * @returns { share, sharedShingles, contentShingles, longestRunWords, passages }
 */
export function overlap(subject, other, common, subjectWords) {
  let content = 0;
  let shared = 0;
  const hits = new Array(subject.list.length).fill(false);
  const seen = new Set();
  subject.list.forEach((s, i) => {
    if (common.has(s)) return;
    if (!seen.has(s)) {
      seen.add(s);
      content++;
      if (other.set.has(s)) shared++;
    }
    if (other.set.has(s)) hits[i] = true;
  });

  // Consecutive matching shingles form one copied passage. A run of n
  // shingles covers n + SHINGLE_WORDS - 1 words.
  const passages = [];
  let start = -1;
  for (let i = 0; i <= hits.length; i++) {
    if (i < hits.length && hits[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const wordsLong = i - start + SHINGLE_WORDS - 1;
      passages.push({ start, words: wordsLong });
      start = -1;
    }
  }
  passages.sort((a, b) => b.words - a.words);

  return {
    share: content ? shared / content : 0,
    sharedShingles: shared,
    contentShingles: content,
    longestRunWords: passages[0]?.words || 0,
    passages: passages.slice(0, 3).map((p) => ({
      words: p.words,
      text: subjectWords.slice(p.start, p.start + p.words).join(' ').slice(0, 600),
    })),
  };
}

/** Whether an overlap is large enough to put in front of HR, and how severe. */
export function grade(result) {
  const meaningfulShare = result.contentShingles >= MIN_CONTENT_SHINGLES ? result.share : 0;
  if (meaningfulShare >= HIGH_SHARE) return 'high';
  if (meaningfulShare >= FLAG_SHARE || result.longestRunWords >= FLAG_RUN_WORDS) return 'medium';
  return null;
}

/**
 * Every candidate copy/repeat flag across a set of reports.
 *
 * @param subjects reports to check — [{ id, owner, text }]
 * @param corpus   everything to check them against, subjects included —
 *                 [{ id, owner, text, ...meta }]. A report is never compared
 *                 with itself; a match with the same owner is a REPEAT, with a
 *                 different owner a COPY.
 * @returns [{ subjectId, otherId, kind, severity, share, longestRunWords, passages }]
 */
export function findOverlaps(subjects, corpus) {
  const prepared = new Map();
  const prep = (doc) => {
    let p = prepared.get(doc.id);
    if (!p) {
      const w = words(doc.text);
      p = { ...doc, words: w, ...shingles(w) };
      prepared.set(doc.id, p);
    }
    return p;
  };
  const all = corpus.map(prep);
  const common = boilerplate(all);

  const found = [];
  for (const raw of subjects) {
    const subject = prep(raw);
    if (!subject.list.length) continue;
    for (const other of all) {
      if (other.id === subject.id || !other.set.size) continue;
      const result = overlap(subject, other, common, subject.words);
      const severity = grade(result);
      if (!severity) continue;
      found.push({
        subjectId: subject.id,
        otherId: other.id,
        kind: other.owner === subject.owner ? 'repeat' : 'copy',
        severity,
        share: Math.round(result.share * 1000) / 10,
        longestRunWords: result.longestRunWords,
        passages: result.passages,
      });
    }
  }
  return found;
}
