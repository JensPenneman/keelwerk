import type { PrincipalKind } from '../principals/principal-kind.ts';

/** The scope an explain request addresses: the operator's session is the deployment's, so the request names the backend or tenant (the CLI's `--backend` and `--tenant`). */
interface ExplainScope {
  readonly backend?: string;
  readonly tenant?: string;
}

/** `--as <kind>[:<id>]`, with the roles `--roles` adds. */
export interface ExplainAs {
  readonly kind: PrincipalKind;
  readonly id?: string;
  readonly roles: readonly string[];
}

/** What `core.explain` asks (the input of `keelwerk explain`, section 16.9.7). */
export type ExplainRequest =
  | (ExplainScope & {
      /** The authorization decision, without executing. */
      readonly mode: 'decision';
      readonly ref: string;
      readonly input?: unknown;
      readonly as?: ExplainAs;
    })
  | (ExplainScope & {
      /** Admission, `prepare` and `decide` in a unit that rolls back. */
      readonly mode: 'dry-run';
      readonly ref: string;
      readonly input?: unknown;
      readonly as?: ExplainAs;
      readonly commandId?: string;
      readonly answers?: Readonly<Record<string, unknown>>;
    })
  | (ExplainScope & {
      /** A command's tree from the chain. */
      readonly mode: 'trace';
      readonly id: string;
    });
