import type { SecretRef } from '../ids/secret-ref.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { IssuedSecret } from '../kernel/issued-secret.ts';
import { absentVerifier } from '../keys/absent-verifier.ts';
import { configSecrets } from '../keys/config-secrets.ts';
import { decoySubject } from '../keys/decoy-subject.ts';
import { openAesGcm } from '../keys/open-aes-gcm.ts';
import { parseSealedValueText } from '../keys/parse-sealed-value-text.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { SecretRequest } from '../protocol/secret-request.ts';
import { refuseRequest } from './refuse-request.ts';
import { requestName } from './request-name.ts';

/**
 * The text of a reference argument: only a `{ ref }` the interpreter decoded for the requesting
 * module (stamped by `decodeRow`), or the module's own configuration secret of this backend
 * (6.6: "available to the owning module's handlers"). A plain string is never a reference.
 */
function textOf(value: unknown, context: AnswerContext): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const ref: unknown = Reflect.get(value, 'ref');
  if (typeof ref !== 'string' || ref === '') return undefined;
  if (configSecrets.isText(ref)) {
    const parsed = configSecrets.parse(ref);
    const { scope } = context;
    return parsed !== undefined &&
      scope.level !== 'deployment' &&
      parsed.backendId === scope.backendId &&
      parsed.moduleId === context.module
      ? ref
      : undefined;
  }
  return Reflect.get(value, secretRefOwner) === context.module ? ref : undefined;
}

async function issue(request: SecretRequest, context: AnswerContext): Promise<IssuedSecret> {
  if (context.form !== 'decide') {
    throw refuseRequest(requestName(request), `a ${context.form} may not request issued secrets`);
  }
  const [options] = request.args;
  const prefix: unknown =
    typeof options === 'object' && options !== null ? Reflect.get(options, 'prefix') : undefined;
  const bytes: unknown =
    typeof options === 'object' && options !== null ? Reflect.get(options, 'bytes') : undefined;
  if (typeof prefix !== 'string' || (bytes !== undefined && typeof bytes !== 'number')) {
    throw refuseRequest(requestName(request), 'it takes { prefix, bytes? }');
  }
  const issued = await context.keys.issue(context.scope, {
    prefix,
    ...(bytes === undefined ? {} : { bytes }),
  });
  // The decoy key of the scope, for the lookups that find no row (see `verify`).
  await context.unit.keys.dataKey(decoySubject, { create: true });
  // The decision record keeps the public id and the verifier, never the token.
  context.record.answer({
    kind: 'secret',
    publicId: issued.publicId,
    verifier: issued.verifier,
  });
  return issued;
}

async function reveal(request: SecretRequest, context: AnswerContext): Promise<string> {
  const [target, reason] = request.args;
  const text = textOf(target, context);
  if (text === undefined)
    throw refuseRequest(
      requestName(request),
      'it takes a secret reference of the requesting module',
    );
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw refuseRequest(requestName(request), 'it needs the reason for the reveal');
  }
  // Logged with its reason by the key service and never recorded in the decision record.
  return context.keys.reveal(context.unit, { ref: text } as unknown as SecretRef, reason);
}

/** A sealed text that opens to nothing under any key: the decoy the absent case decrypts. */
const decoyNonce = new Uint8Array(12);
const decoyCiphertext = new Uint8Array(32);
const decoyAad = new Uint8Array(0);

async function verify(request: SecretRequest, context: AnswerContext): Promise<boolean> {
  const [token, verifier] = request.args;
  if (typeof token !== 'string' || typeof verifier !== 'string') {
    throw refuseRequest(requestName(request), 'it takes a token and a verifier');
  }
  if (verifier === absentVerifier) {
    // No row holds the key. A found row takes two reads of key material (the data key of its
    // personal label, then the key of its sealed verifier) and one decryption: take the same from
    // the decoy data key, then compare, so the work does not tell whether a row exists. A scope
    // that never issued a secret has no decoy key and holds no key to find either.
    const { keys } = context.unit;
    await keys.dataKey(decoySubject, { create: false });
    const decoy = await keys.dataKey(decoySubject, { create: false });
    if (decoy !== undefined) openAesGcm(decoy.material, decoyNonce, decoyCiphertext, decoyAad);
    await context.keys.verify(context.scope, token, absentVerifier);
    return false;
  }
  // A verifier read from a row is its sealed text; the comparison needs the value itself.
  const sealed = parseSealedValueText(verifier);
  let plain = verifier;
  if (sealed !== undefined) {
    const opened = await context.unit.keys.openValue(sealed);
    if (opened === undefined) return false;
    plain = new TextDecoder().decode(opened);
  }
  return context.keys.verify(context.scope, token, plain);
}

/**
 * Answers the secret requests (7.9.3) through the key service: `issue` returns the token once and
 * records its public id and verifier; `reveal` opens a sealed value, logs its reason and records
 * nothing; `verify` compares a presented token with a verifier in constant time, recording nothing.
 */
export function answerSecret(
  request: SecretRequest,
  context: AnswerContext,
): Promise<IssuedSecret | string | boolean> {
  switch (request.op) {
    case 'issue':
      return issue(request, context);
    case 'reveal':
      return reveal(request, context);
    case 'verify':
      return verify(request, context);
  }
}
