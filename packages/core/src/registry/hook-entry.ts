import type { HookPayloads } from '../dsl/define-hook.ts';
import type { ActionHandler } from './action-handler.ts';

/** A lifecycle hook (section 3.3). Each runs in a unit of its own at `unit`'s level after the creating unit commits (S-27). */
export interface HookEntry {
  /** '<module>.<hook>'. */
  readonly id: string;
  readonly module: string;
  readonly hook: keyof HookPayloads;
  /** The scope level of the unit the hook decides in: tenant hooks in a tenant unit, backend hooks in a backend unit. */
  readonly unit: 'tenant' | 'backend';
  /** Pure, under the module's service principal; returns a decision. */
  readonly react: ActionHandler;
  readonly contributedBy?: string;
}
