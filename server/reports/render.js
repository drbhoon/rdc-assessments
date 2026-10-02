/**
 * The AI evaluation report, as HTML (shown in the consoles) and as a PDF
 * (downloaded by the supervisor, attached to the trainee's results e-mail).
 *
 * Both are drawn from the stored scores, so the screen, the PDF and the Excel
 * summary can never disagree. The layout follows the report the Operations and
 * Sales evaluators have always produced: score top right, executive summary,
 * strengths and gaps, the six criteria, then the roadmap.
 *
 * Red flags are deliberately absent. They are for HR and the supervisor, and
 * this report is what the trainee receives.
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { MAX_POINTS } from './ai.js';

export const TRACK_TITLE = {
  ops: 'Trainee Report Assessment - Operations',
  sales: 'Trainee Report Assessment - Sales',
};
export const TRACK_NAME = { ops: 'Operations', sales: 'Sales' };

export const RATING_LABEL = { 5: 'Excellent', 4: 'Good', 3: 'Average', 2: 'Weak', 1: 'Poor' };

const IST = 'Asia/Kolkata';

/** "30 Sep 2026" in IST. */
export function istDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' });
}

/** "30 Sep 2026, 4:05 pm" in IST. */
export function istDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-IN', {
    timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One line under the title: who, where, which month. */
function subtitle(a, cycle) {
  return [`${a.trainee_name} (${a.trainee_code})`, a.trainee_location, cycle.period_label].filter(Boolean).join(' · ');
}

/**
 * @param a      assignment row (ai_result, trainee_*, supervisor_*)
 * @param cycle  cycle row
 * @param opts.withSupervisor include the supervisor's rating and comments
 */
export function reportHtml(a, cycle, { withSupervisor = false } = {}) {
  const r = a.ai_result;
  if (!r) return '<p>No evaluation yet.</p>';
  const li = (items) => items.map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  const rows = r.criteria.map((c) => `
        <tr>
            <td style="padding: 10px; border: 1px solid #ddd;">${escapeHtml(c.name)}</td>
            <td style="padding: 10px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${c.score}/5</td>
            <td style="padding: 10px; border: 1px solid #ddd;">${escapeHtml(c.insight)}</td>
        </tr>`).join('');

  const supervisor = withSupervisor && a.supervisor_rating ? `
<div style="border: 2px solid #1565C0; padding: 15px; border-radius: 8px; margin-top: 20px;">
    <h3 style="margin-top: 0; color: #1565C0;">Supervisor's Assessment</h3>
    <p style="margin: 4px 0;"><strong>${escapeHtml(a.supervisor_name)}</strong> rated this report
    <strong>${a.supervisor_rating}/5 (${RATING_LABEL[a.supervisor_rating] || ''})</strong>.</p>
    ${a.supervisor_comments ? `<p style="line-height: 1.6; white-space: pre-wrap; margin-bottom: 0;">${escapeHtml(a.supervisor_comments)}</p>` : ''}
</div>` : '';

  return `<div style="font-family: sans-serif; border: 1px solid #e0e0e0; padding: 25px; border-radius: 8px; background: #fff; color: #1e293b;">
<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #2E7D32; padding-bottom: 15px; gap: 16px;">
    <div>
        <h1 style="margin: 0; color: #2E7D32; font-size: 22px;">${TRACK_TITLE[cycle.track]}</h1>
        <p style="margin: 5px 0; color: #666;">Trainee: <strong>${escapeHtml(subtitle(a, cycle))}</strong></p>
    </div>
    <div style="text-align: right; white-space: nowrap;">
        <div style="font-size: 24px; font-weight: bold; color: #F57C00;">${r.percent}%</div>
        <div style="font-size: 12px; text-transform: uppercase; color: #F57C00;">${r.points}/${MAX_POINTS} pts</div>
    </div>
</div>
<h3 style="color: #2E7D32;">Executive Summary</h3>
<p style="line-height: 1.6;">${escapeHtml(r.executive_summary)}</p>
<div style="display: flex; gap: 20px; margin: 20px 0; flex-wrap: wrap;">
    <div style="flex: 1; min-width: 220px; background: #E8F5E9; padding: 15px; border-radius: 5px;">
        <strong style="color: #2E7D32;">✓ Core Strengths</strong>
        <ul style="padding-left: 20px; font-size: 14px; margin-bottom: 0;">${li(r.strengths)}</ul>
    </div>
    <div style="flex: 1; min-width: 220px; background: #FFF3E0; padding: 15px; border-radius: 5px;">
        <strong style="color: #E65100;">⚠ Priority Gaps</strong>
        <ul style="padding-left: 20px; font-size: 14px; margin-bottom: 0;">${li(r.gaps)}</ul>
    </div>
</div>
<h3 style="color: #2E7D32;">Performance Breakdown</h3>
<table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
    <thead>
        <tr style="background-color: #f5f5f5;">
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Area</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: center;">Rating (0-5)</th>
            <th style="padding: 10px; border: 1px solid #ddd; text-align: left;">Evaluator Insight</th>
        </tr>
    </thead>
    <tbody>${rows}</tbody>
</table>
<div style="border: 2px dashed #2E7D32; padding: 15px; border-radius: 8px;">
    <h3 style="margin-top: 0; color: #2E7D32;">Post-Assessment Roadmap / Suggestions</h3>
    <ol style="line-height: 1.8; margin-bottom: 0;">${li(r.roadmap)}</ol>
</div>${supervisor}
</div>`;
}

// ── PDF ─────────────────────────────────────────────────────────────────────

const GREEN = '#2E7D32';
const ORANGE = '#F57C00';
const BLUE = '#1565C0';
const INK = '#1e293b';
const MUTED = '#666666';

/** dist/ in the container, public/ in development. */
function logoPath() {
  for (const p of [path.join(process.cwd(), 'dist', 'rdc_logo.png'), path.join(process.cwd(), 'public', 'rdc_logo.png')]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * The PDF's built-in fonts cover Latin-1 plus a few typographic marks. The
 * rupee sign becomes "Rs." and anything else outside that set (Devanagari,
 * emoji) a "?", rather than the garbled glyphs the fonts would otherwise draw.
 */
const WIN_ANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);
export function pdfSafe(value) {
  return [...String(value ?? '').replace(/₹\s?/g, 'Rs. ')]
    .map((ch) => (ch.codePointAt(0) <= 0xff || WIN_ANSI_EXTRA.has(ch) ? ch : '?'))
    .join('');
}

/** The stored result with every string made safe for the PDF fonts. */
function pdfCopy(a) {
  const r = a.ai_result;
  return {
    ...a,
    trainee_name: pdfSafe(a.trainee_name),
    trainee_location: pdfSafe(a.trainee_location),
    supervisor_name: pdfSafe(a.supervisor_name),
    supervisor_comments: pdfSafe(a.supervisor_comments),
    ai_result: {
      ...r,
      executive_summary: pdfSafe(r.executive_summary),
      strengths: r.strengths.map(pdfSafe),
      gaps: r.gaps.map(pdfSafe),
      roadmap: r.roadmap.map(pdfSafe),
      criteria: r.criteria.map((c) => ({ ...c, name: pdfSafe(c.name), insight: pdfSafe(c.insight) })),
    },
  };
}

/** @returns Promise<Buffer> */
export function reportPdf(original, cycleIn, { withSupervisor = false } = {}) {
  const a = pdfCopy(original);
  const cycle = { ...cycleIn, period_label: pdfSafe(cycleIn.period_label) };
  const r = a.ai_result;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${TRACK_TITLE[cycle.track]} - ${a.trainee_name}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const ensure = (h) => { if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage(); };
    const heading = (text, color = GREEN) => {
      ensure(40);
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(13).fillColor(color).text(text, left, doc.y, { width });
      doc.moveDown(0.3);
    };
    const bullets = (items, numbered = false) => {
      items.forEach((item, i) => {
        ensure(30);
        doc.font('Helvetica').fontSize(10.5).fillColor(INK)
          .text(`${numbered ? `${i + 1}.` : '•'}  ${item}`, left + 8, doc.y, { width: width - 8, lineGap: 2 });
        doc.moveDown(0.2);
      });
    };

    // Header: logo, title, score.
    const logo = logoPath();
    const top = doc.y;
    if (logo) doc.image(logo, left, top, { fit: [96, 44] });
    const titleX = logo ? left + 108 : left;
    doc.font('Helvetica-Bold').fontSize(16).fillColor(GREEN)
      .text(TRACK_TITLE[cycle.track], titleX, top, { width: width - (titleX - left) - 110 });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
      .text(subtitle(a, cycle), titleX, doc.y + 2, { width: width - (titleX - left) - 110 });
    const afterTitle = doc.y;
    doc.font('Helvetica-Bold').fontSize(22).fillColor(ORANGE)
      .text(`${r.percent}%`, left + width - 110, top, { width: 110, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(ORANGE)
      .text(`${r.points}/${MAX_POINTS} PTS`, left + width - 110, doc.y, { width: 110, align: 'right' });
    doc.y = Math.max(afterTitle, doc.y, top + 44) + 8;
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(2.5).strokeColor(GREEN).stroke();

    heading('Executive Summary');
    doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(r.executive_summary, left, doc.y, { width, lineGap: 2 });

    heading('Core Strengths');
    bullets(r.strengths);
    heading('Priority Gaps', '#E65100');
    bullets(r.gaps);

    // Criteria table.
    heading('Performance Breakdown');
    const cols = [width * 0.3, width * 0.12, width * 0.58];
    const row = (cells, { bold = false, fill = null } = {}) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5);
      const heights = cells.map((c, i) => doc.heightOfString(String(c), { width: cols[i] - 10 }));
      const h = Math.max(...heights) + 10;
      ensure(h);
      const y = doc.y;
      let x = left;
      cells.forEach((c, i) => {
        if (fill) doc.rect(x, y, cols[i], h).fill(fill);
        doc.rect(x, y, cols[i], h).lineWidth(0.5).strokeColor('#dddddd').stroke();
        doc.fillColor(INK).font(bold || i === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5)
          .text(String(c), x + 5, y + 5, { width: cols[i] - 10, align: i === 1 ? 'center' : 'left' });
        x += cols[i];
      });
      doc.x = left;
      doc.y = y + h;
    };
    row(['Area', 'Rating', 'Evaluator Insight'], { bold: true, fill: '#f5f5f5' });
    r.criteria.forEach((c) => row([c.name, `${c.score}/5`, c.insight]));

    heading('Post-Assessment Roadmap / Suggestions');
    bullets(r.roadmap, true);

    if (withSupervisor && a.supervisor_rating) {
      heading("Supervisor's Assessment", BLUE);
      doc.font('Helvetica').fontSize(10.5).fillColor(INK)
        .text(`${a.supervisor_name} rated this report ${a.supervisor_rating}/5 (${RATING_LABEL[a.supervisor_rating] || ''}).`, left, doc.y, { width });
      if (a.supervisor_comments) {
        doc.moveDown(0.4).text(a.supervisor_comments, left, doc.y, { width, lineGap: 2 });
      }
    }

    doc.end();
  });
}
