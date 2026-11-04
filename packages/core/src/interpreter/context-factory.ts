import type { Scope } from '../storage/scope.ts';

/** The contexts of one invocation, one per module and scope, built on first use (section 7.6). */
export interface ContextFactory {
  /**
   * The context a part of `module` receives; services and fills of a module receive its own. The
   * scope defaults to the invocation's; a query asked in another scope receives that scope's.
   */
  forModule(module: string, scope?: Scope): Readonly<Record<string, unknown>>;
}
