import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

function declarationFiles(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...declarationFiles(path));
    else if (entry.name.endsWith('.d.ts')) found.push(path);
  }
  return found;
}

/** What one module package emitted, in bytes of `.d.ts`. */
export interface DeclarationSize {
  readonly name: string;
  /** `module.generated.d.ts`, or 0 when the package has none. */
  readonly manifestBytes: number;
  /** Every `.d.ts` of the package together. */
  readonly totalBytes: number;
  readonly largestFile: string;
  readonly largestBytes: number;
}

/** The two limits of architecture 13.11. */
export interface DeclarationBudget {
  readonly manifestBytes: number;
  readonly packageBytes: number;
  /** Path prefixes whose measurements are reported but exempt from both limits. */
  readonly exempt: readonly string[];
  /** Limits of single packages by name, each with the reason it differs from the default. */
  readonly overrides?: Readonly<
    Record<
      string,
      { readonly manifestBytes?: number; readonly packageBytes?: number; readonly reason: string }
    >
  >;
}

/** Measures the `.d.ts` files under `directory`, which holds one module package's emit. */
export function checkDeclarationSizes(name: string, directory: string): DeclarationSize {
  let manifestBytes = 0;
  let totalBytes = 0;
  let largestFile = '';
  let largestBytes = 0;
  for (const file of declarationFiles(directory)) {
    const bytes = statSync(file).size;
    const shown = relative(directory, file).split(sep).join('/');
    totalBytes += bytes;
    if (shown === 'module.generated.d.ts') manifestBytes = bytes;
    if (bytes > largestBytes) {
      largestBytes = bytes;
      largestFile = shown;
    }
  }
  return { name, manifestBytes, totalBytes, largestFile, largestBytes };
}
