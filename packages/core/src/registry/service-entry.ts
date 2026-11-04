import type { ActionHandler } from './action-handler.ts';

/** A service a module offers its dependants (section 5.5); the kernel binds it to the providing module's context per invocation. */
export interface ServiceEntry {
  /** 'auth.verifyPassword'. */
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  /** `(own, ...args)`: returns a value, a request or a generator, never a promise. */
  readonly fn: ActionHandler;
}
