import { canonicalizeJson } from '@keelwerk/core';
import { sha256 } from '@keelwerk/core/crypto';
import type { FrameworkStep } from './framework-step.ts';

/** The root the checksum renders at; an application id is kebab case and never holds `__` (S-09). */
const templateRoot = 'kw__root';

/**
 * The checksum of a framework step: the SHA-256 of the canonical JSON of the step's statements
 * rendered at a fixed template root, lower-case hexadecimal (section 14.6.3). It does not depend
 * on the namespace's root, and grants are outside it because they name the deployment's role.
 */
export function frameworkStepChecksum(
  step: FrameworkStep,
  options: { readonly control?: boolean },
): string {
  return sha256(canonicalizeJson(step.ddl(templateRoot, options)));
}
