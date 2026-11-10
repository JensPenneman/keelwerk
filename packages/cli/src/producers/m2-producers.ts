import type { AppDerivation } from './app-derivation.ts';
import type { ProducedFiles } from './produced-files.ts';
import type { ProducerName } from './producer-name.ts';

/** The producers M2 adds to `keelwerk generate`, each run under an existing `--only` name after M1's. */
export const m2Producers: readonly {
  /** The `--only` name it runs under. */
  readonly under: Exclude<ProducerName, 'manifests'>;
  /** The progress line once it has run. */
  readonly done: string;
  produce(root: string, apps: readonly AppDerivation[], check: boolean): Promise<ProducedFiles>;
}[] = [];
