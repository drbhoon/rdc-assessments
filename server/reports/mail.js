/**
 * E-mails for monthly report cycles. Same SMTP settings PARAKH uses
 * (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM).
 *
 * Every send returns rather than throws: the caller stores the error against
 * the trainee or supervisor it was for, so HR can see exactly who did not get
 * their link instead of one failure stopping the rest.
 */
import nodemailer from 'nodemailer';
import { escapeHtml, istDate, RATING_LABEL, TRACK_NAME } from './render.js';
import { MAX_POINTS } from './ai.js';

let transport = null;

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST);
}

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      pool: true,
      maxConnections: 3,
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return transport;
}

/** @returns { ok: true } | { ok: false, error } */
async function send({ to, subject, html, attachments }) {
  if (!mailConfigured()) return { ok: false, error: 'E-mail is not configured (SMTP_HOST).' };
  try {
    await getTransport().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      attachments,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || 'Send failed' };
  }
}

function frame(body) {
  return `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #1e293b; max-width: 620px; line-height: 1.6;">
${body}
<p style="margin-top: 28px; color: #64748b; font-size: 12px;">RDC Concrete (India) Ltd — HR. This is an automated message.</p>
</div>`;
}

function button(href, label) {
  return `<p style="margin: 22px 0;"><a href="${escapeHtml(href)}" style="background: #2E7D32; color: #fff; padding: 11px 22px; border-radius: 6px; text-decoration: none; font-weight: bold;">${escapeHtml(label)}</a></p>
<p style="font-size: 12px; color: #64748b;">If the button does not work, copy this link into your browser:<br>${escapeHtml(href)}</p>`;
}

const firstName = (name) => escapeHtml(String(name || '').trim());

export function sendTraineeInvite({ a, cycle, link, kind = 'invite' }) {
  const track = TRACK_NAME[cycle.track];
  const until = istDate(a.reopen_until && new Date(a.reopen_until) > new Date(cycle.submit_by) ? a.reopen_until : cycle.submit_by);
  const lead = {
    invite: `Please upload your <strong>${track} monthly progress report for ${escapeHtml(cycle.period_label)}</strong> using the link below.`,
    reminder: `This is a reminder that your <strong>${track} monthly progress report for ${escapeHtml(cycle.period_label)}</strong> has not been uploaded yet.`,
    reopen: `Your link to upload the <strong>${track} monthly progress report for ${escapeHtml(cycle.period_label)}</strong> has been reopened.`,
  }[kind];
  const subject = {
    invite: `Upload your monthly report — ${cycle.period_label}`,
    reminder: `Reminder: monthly report due ${until}`,
    reopen: `Monthly report link reopened — ${cycle.period_label}`,
  }[kind];
  return send({
    to: a.trainee_email,
    subject,
    html: frame(`<p>Dear ${firstName(a.trainee_name)},</p>
<p>${lead}</p>
<p>The last date is <strong>${until}</strong>. You may upload a PDF, Word file or photo of your report, and replace it as often as you like until then.</p>
${button(link, 'Upload my report')}`),
  });
}

export function sendSupervisorNotice({ sup, cycle, trainees, link, kind = 'notice' }) {
  const list = trainees.map((t) => `<li>${escapeHtml(t.trainee_name)} (${escapeHtml(t.trainee_code)})${t.trainee_location ? ` — ${escapeHtml(t.trainee_location)}` : ''}</li>`).join('');
  const reminder = kind === 'reminder';
  return send({
    to: sup.supervisor_email,
    subject: reminder
      ? `Reminder: trainee reports awaiting your rating — due ${istDate(cycle.review_by)}`
      : `Trainee reports ready for your review — ${cycle.period_label}`,
    html: frame(`<p>Dear ${firstName(sup.supervisor_name)},</p>
<p>${reminder ? 'These' : 'The'} ${TRACK_NAME[cycle.track]} monthly reports for <strong>${escapeHtml(cycle.period_label)}</strong> from the trainees you supervise ${reminder ? 'are still awaiting your rating' : 'have been evaluated and are ready for your review'}:</p>
<ul>${list}</ul>
<p>For each one you can download the trainee's report and the AI assessment, then give your comments and a final rating out of 5. Please complete this by <strong>${istDate(cycle.review_by)}</strong>.</p>
${button(link, 'Review the reports')}`),
  });
}

export function sendResults({ a, cycle, pdf }) {
  const r = a.ai_result;
  const rated = a.supervisor_rating
    ? `<p><strong>Supervisor's rating:</strong> ${a.supervisor_rating}/5 (${RATING_LABEL[a.supervisor_rating] || ''}) — ${escapeHtml(a.supervisor_name)}</p>
${a.supervisor_comments ? `<p><strong>Supervisor's comments:</strong><br><span style="white-space: pre-wrap;">${escapeHtml(a.supervisor_comments)}</span></p>` : ''}`
    : `<p><strong>Supervisor's rating:</strong> not given.</p>`;
  const safeName = String(a.trainee_name).replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_') || a.trainee_code;
  return send({
    to: a.trainee_email,
    subject: `Your monthly report evaluation — ${cycle.period_label}`,
    html: frame(`<p>Dear ${firstName(a.trainee_name)},</p>
<p>Your ${TRACK_NAME[cycle.track]} monthly progress report for <strong>${escapeHtml(cycle.period_label)}</strong> has been evaluated.</p>
<p><strong>AI evaluation score:</strong> ${r.percent}% (${r.points}/${MAX_POINTS})</p>
${rated}
<p>The full evaluation report is attached. Use the roadmap at the end of it to plan next month.</p>
${a.hr_spoc_name ? `<p>For any questions, please contact your HR SPOC, <strong>${escapeHtml(a.hr_spoc_name)}</strong>.</p>` : ''}`),
    attachments: [{ filename: `Report_Evaluation_${safeName}_${String(cycle.period_label).replace(/\s+/g, '_')}.pdf`, content: pdf }],
  });
}
