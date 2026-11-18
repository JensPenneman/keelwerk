import { withheldMember } from '../write-path/withheld-member.ts';

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `input` with every member value of every `config.<module>` object replaced by `withheldMember`,
 * and a module value that is no plain object replaced whole; module ids and member names stay.
 * The fingerprint of a backend create covers no configuration value: every value is withheld, not
 * only the secret ones, because a replay skips the checks and may run where the modules' shapes
 * are unknown. Any other input, or one without `config`, is answered as it is.
 */
export function maskConfigValues(input: unknown): unknown {
  if (!isPlainObject(input)) return input;
  const { config } = input;
  if (config === undefined || config === null) return input;
  if (!isPlainObject(config)) return { ...input, config: withheldMember };
  const masked: Record<string, unknown> = {};
  for (const [moduleId, value] of Object.entries(config)) {
    masked[moduleId] = isPlainObject(value)
      ? Object.fromEntries(Object.keys(value).map((name) => [name, withheldMember]))
      : withheldMember;
  }
  return { ...input, config: masked };
}
