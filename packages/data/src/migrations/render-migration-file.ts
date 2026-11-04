import type { MigrationStep } from '@keelwerk/core';
import { renderLiteral } from './render-literal.ts';

/** What `db generate` writes: the pure parts of a `MigrationFile`. */
export interface GeneratedMigration {
  /** '0002-profile-locale'. */
  readonly id: string;
  readonly track: string;
  readonly steps: readonly MigrationStep[];
  readonly renames?: readonly {
    readonly entity: string;
    readonly from: string;
    readonly to: string;
  }[];
}

/**
 * The text of `NNNN-<name>.ts` (section 14.6.2, S-56): one `migration` export holding the neutral
 * steps. Keys are sorted and the layout is fixed, so the same file always renders to the same
 * bytes; the checksum covers the steps, never the text.
 */
export function renderMigrationFile(file: GeneratedMigration): string {
  const body = {
    id: file.id,
    track: file.track,
    steps: file.steps,
    ...(file.renames === undefined || file.renames.length === 0 ? {} : { renames: file.renames }),
  };
  return `import type { MigrationFile } from '@keelwerk/core';

export const migration: MigrationFile = ${renderLiteral(body)};
`;
}
