import { defaultRandomSource } from './default-random-source.ts';
import type { DeriveScopeKey } from './derive-scope-key.ts';
import { openKwe } from './open-kwe.ts';
import type { RandomSource } from './random-source.ts';
import { sealKwe } from './seal-kwe.ts';

const prefix = 'kwc1';
/** The version of the backend-key derivation the stored text records; opening refuses any other. */
const keyVersion = '1';
const infoOf = (version: string): string => `keelwerk/config-secret/${version}`;

const bindingOf = (binding: ConfigSecretBinding) => ({
  namespace: 'config',
  streamId: binding.backendId,
  eventId: binding.moduleId,
  field: binding.field,
});

/**
 * Seals a module configuration secret under the backend key (5.7, S-70): AES-256-GCM through
 * `sealKwe` with a key derived from the backend's key, the backend, module and field as associated
 * data. The stored text is `kwc1.<backend id>.<module id>.<field>.<key version>.<nonce>.<ciphertext>`;
 * module ids and field names contain no dot.
 */
async function seal(
  derive: DeriveScopeKey,
  binding: ConfigSecretBinding,
  plain: string,
  random: RandomSource = defaultRandomSource,
): Promise<string> {
  const material = await derive(
    { level: 'backend', backendId: binding.backendId },
    infoOf(keyVersion),
    32,
  );
  const envelope = sealKwe(
    { id: binding.backendId, material },
    new TextEncoder().encode(plain),
    bindingOf(binding),
    random,
  );
  return [
    prefix,
    binding.backendId,
    binding.moduleId,
    binding.field,
    keyVersion,
    envelope.n,
    envelope.c,
  ].join('.');
}

/** Whether a reference text is a sealed configuration secret. */
function isText(text: string): boolean {
  return text.startsWith(`${prefix}.`);
}

/** What a sealed text names, `undefined` when it is malformed. */
function parse(text: string): ParsedConfigSecret | undefined {
  const parts = text.split('.');
  const [version, backendId, moduleId, field, key, n, c] = parts;
  if (
    parts.length !== 7 ||
    version !== prefix ||
    !backendId ||
    !moduleId ||
    !field ||
    !key ||
    !n ||
    !c
  ) {
    return undefined;
  }
  return { backendId, moduleId, field, keyVersion: key, n, c };
}

/**
 * Opens a sealed configuration secret; `undefined` when the text is malformed, records an unknown
 * key version or does not open. Pass a `derive` that does not create keys: a text naming a
 * backend without a key must not make one.
 */
async function open(derive: DeriveScopeKey, text: string): Promise<string | undefined> {
  const parsed = parse(text);
  if (parsed === undefined || parsed.keyVersion !== keyVersion) return undefined;
  const { backendId, moduleId, field, n, c } = parsed;
  const material = await derive({ level: 'backend', backendId }, infoOf(parsed.keyVersion), 32);
  const plain = openKwe({ $kwe: 1, k: backendId, n, c }, material, {
    namespace: 'config',
    streamId: backendId,
    eventId: moduleId,
    field,
  });
  if (plain === undefined) return undefined;
  return new TextDecoder().decode(plain);
}

/** What names one configuration secret: the backend, the module and the field. */
interface ConfigSecretBinding {
  readonly backendId: string;
  readonly moduleId: string;
  readonly field: string;
}

/** A parsed configuration secret text. */
interface ParsedConfigSecret extends ConfigSecretBinding {
  readonly keyVersion: string;
  readonly n: string;
  readonly c: string;
}

/** Module configuration secrets under the backend key (5.7, S-70): `seal` at `createBackend`, `open` at reveal, `isText` to tell the form, `parse` to read what a text names. */
export const configSecrets: {
  readonly seal: typeof seal;
  readonly open: typeof open;
  readonly isText: typeof isText;
  readonly parse: typeof parse;
} = { seal, open, isText, parse };
