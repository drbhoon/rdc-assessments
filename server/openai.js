/**
 * The one place this app talks to OpenAI.
 *
 * Plain fetch to the Responses API, the same way the LMS does it, so there is
 * no SDK to keep in step. Every AI call in the app — trainee report scoring,
 * scanned-report transcription, copy/repeat judging and the older HTML
 * evaluators — goes through respond().
 *
 * OPENAI_BASE_URL is unset in every real deployment; it exists so the whole
 * app can be exercised locally against a stand-in.
 */

const BASE = () => String(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
export const model = () => process.env.OPENAI_MODEL || 'gpt-5.4-mini';

/**
 * A file the model should read itself: a PDF as input_file, a picture as
 * input_image. Anything else has to be sent as text by the caller.
 *
 * @param data  Buffer, or base64 (a data: URL prefix is tolerated)
 */
export function fileItem({ data, mime, filename = 'report' }) {
  const base64 = Buffer.isBuffer(data) || data instanceof Uint8Array
    ? Buffer.from(data).toString('base64')
    : String(data).replace(/^data:[^,]*,/, '');
  const url = `data:${mime};base64,${base64}`;
  if (String(mime).startsWith('image/')) return { type: 'input_image', image_url: url };
  if (mime === 'application/pdf') {
    return { type: 'input_file', filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`, file_data: url };
  }
  throw new Error(`The AI cannot read ${mime} files directly.`);
}

/** Can fileItem() send this type? */
export const readableFile = (mime) => mime === 'application/pdf' || String(mime || '').startsWith('image/');

/** A user turn made of a file and an instruction. */
export const fileInput = (file, text) => [
  { role: 'user', content: [fileItem(file), { type: 'input_text', text }] },
];

function outputText(data) {
  for (const item of data?.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  return null;
}

/** Overloads and rate limits pass; a bad key or a bad request does not. */
const retryable = (status) => status === 408 || status === 429 || status >= 500;

/**
 * One Responses API call, tried up to three times with a pause between.
 *
 * @param instructions  the system prompt
 * @param input         a string, or fileInput(...)
 * @param schema        a JSON schema: the reply is parsed and returned as an object
 * @returns the reply text, or the parsed object when a schema was given
 */
export async function respond({ instructions, input, schema, schemaName = 'result', maxOutputTokens = 8000, timeoutMs = 180_000 }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key (OPENAI_API_KEY) is not set in environment variables on the backend.');
  }

  const body = {
    model: model(),
    store: false,
    instructions,
    input,
    reasoning: { effort: 'low' },
    max_output_tokens: maxOutputTokens,
  };
  if (schema) {
    body.text = { format: { type: 'json_schema', name: schemaName, strict: true, schema } };
  }

  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response;
    try {
      response = await fetch(`${BASE()}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      last = new Error(err?.name === 'TimeoutError'
        ? 'OpenAI did not respond in time.'
        : `Could not reach OpenAI: ${err?.message || 'network error'}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 4000));
      continue;
    }

    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      const detail = String(failure?.error?.message || 'Unknown API error').slice(0, 500);
      last = new Error(`OpenAI request failed (${response.status}): ${detail}`);
      if (retryable(response.status) && attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 4000));
        continue;
      }
      throw last;
    }

    const data = await response.json();
    const text = outputText(data);
    if (!text) {
      throw new Error(data?.status === 'incomplete'
        ? `OpenAI stopped before finishing (${data?.incomplete_details?.reason || 'incomplete'}).`
        : 'OpenAI returned no text.');
    }
    if (!schema) return text;
    return JSON.parse(text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim());
  }
  throw last;
}
