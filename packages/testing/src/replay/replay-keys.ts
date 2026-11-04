import type { KeyService } from '@keelwerk/core';
import { errors } from '@keelwerk/core';

const refusal = () => Promise.reject(errors.unsupported('A re-decide has no key service.'));

/** Keys are not part of a re-decide: every call says so instead of answering. */
export const replayKeys: KeyService = {
  issue: refusal,
  verify: refusal,
  reveal: refusal,
  derive: refusal,
  invalidate: () => undefined,
};
