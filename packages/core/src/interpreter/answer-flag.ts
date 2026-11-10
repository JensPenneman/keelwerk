import type { FlagResolution } from '../contexts/flag-resolution.ts';
import { defaultFlagReason } from '../events/default-flag-reason.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { FlagRequest } from '../protocol/flag-request.ts';
import { refuseRequest } from './refuse-request.ts';

/** What a flag request answers: the value, or its resolution for `ctx.flagDetails`. */
type FlagAnswer = boolean | string | number | FlagResolution<unknown>;

/**
 * Answers a flag request with the flag's declared default and the reason `DEFAULT`, and records
 * the read in the flags the invocation read (S-23). The key is `<module id>.<flag>`; providers,
 * targeting and `core.flag` arrive with M2.
 */
export async function answerFlag(
  request: FlagRequest,
  context: AnswerContext,
): Promise<FlagAnswer> {
  const split = request.key.lastIndexOf('.');
  const module = context.registry.modules.find((entry) => entry.id === request.key.slice(0, split));
  const flag = module?.flags[request.key.slice(split + 1)];
  if (module === undefined || flag === undefined) {
    throw refuseRequest('flag', `"${request.key}" is not a flag of this app`);
  }
  const value = flag.default;
  const variant = typeof value === 'object' ? 'default' : String(value);
  const read = { key: request.key, variant, reason: defaultFlagReason, ruleVersion: null };
  context.record.flag(read);
  if (!request.details) return value as FlagAnswer;
  return { value, variant, reason: defaultFlagReason, provider: 'default' };
}
