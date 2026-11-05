import type { Decoded } from './decoded.ts';
import type { Sent } from './sent.ts';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function bodyOf(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Decodes a response that carries either a value or an error. REST answers an error as a problem
 * document and the value as the body; the invocation protocol wraps both in an envelope.
 */
export async function decodeAnswer(response: Response, enveloped: boolean): Promise<Sent> {
  const body = await bodyOf(response);
  const accepted = response.status === 202;
  let decoded: Decoded;
  // The host answers its own errors (no tenant, a failed origin check) in the envelope on every route.
  if (enveloped && isRecord(body) && body.ok === true) {
    decoded = { ok: true, value: body.value, accepted };
  } else if (isRecord(body) && body.ok === false && isRecord(body.error)) {
    decoded = { ok: false, kind: String(body.error.kind), code: String(body.error.code) };
  } else if (!enveloped && response.status < 400) {
    decoded = { ok: true, value: body, accepted };
  } else if (isRecord(body)) {
    decoded = { ok: false, kind: String(body.kind), code: String(body.code) };
  } else {
    decoded = { ok: false, kind: 'unparsed', code: String(response.status) };
  }
  return { decoded, response, body };
}
