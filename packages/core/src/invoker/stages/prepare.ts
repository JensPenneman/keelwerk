import type { ActionEntry } from '../../registry/action-entry.ts';

/**
 * `prepare` (section 9.2): admits the commands that declare `prepare`. The handler itself runs in
 * the write path, outside any unit of the command (`runPrepare`, section 7.9.4 phase 2), once per
 * invocation; this stage has nothing left to refuse because the registry already refuses `prepare`
 * on an asynchronous or offline command at compose.
 */
export function prepare(_action: ActionEntry): void {}
