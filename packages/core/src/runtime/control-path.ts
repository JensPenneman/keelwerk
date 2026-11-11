import type { ControlRun } from '../control/control-run.ts';
import type { BackendInput } from '../control/create-backend.ts';
import type { TenantInput } from '../control/create-tenant.ts';
import type { FlagTargetingCheck } from './flag-targeting-check.ts';

/** What a control create answers: the new row's id, and whether the command id replayed an earlier create. */
interface ControlCreated {
  readonly id: string;
  readonly replayed: boolean;
}

/**
 * The runtime's path for the explicit control commands (S-109): the catalogue, placement and
 * version checks, the write, the directory refresh and the hooks, for any principal and any
 * command id. The command runner routes `core.backend.create` and `core.tenant.create` to it,
 * and `Runtime.control` calls it as the runtime's own operator.
 */
export interface ControlPath {
  createBackend(input: BackendInput, who: ControlRun): Promise<ControlCreated>;
  createTenant(input: TenantInput, who: ControlRun): Promise<ControlCreated>;
  /**
   * Checks a flag's targeting against its declaration before `core.flag.set` writes it: in the
   * backend's app, or in every served app that declares the key when no backend is named.
   * Throws `validation` (no app declares the key, or a value does not fit), `not_found` (no such
   * backend) or `unavailable` (the backend's app is not served by this process).
   */
  checkFlagTargeting(input: FlagTargetingCheck): Promise<void>;
  /**
   * Checks the rule set `core.flag.restoreRules` would write (the row's `previous`) against the
   * flag's declaration. Reads the one row by its id. A row not at `ifVersion` is a `conflict`
   * (`core.version_mismatch`): the check and the write agree on one version, because the command
   * writes with the same `ifVersion` as its expected version, so a `core.flag.set` in between
   * makes the write conflict too. A missing row or a row without an earlier rule set passes: the
   * command itself answers it.
   */
  checkFlagRestore(id: string, ifVersion: number): Promise<void>;
}
