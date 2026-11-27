import { type Combo, memberOf } from './marked-grid.ts';
import { otherAt, personalAt, skeletonApp } from './marked-skeleton.ts';

/** What the registry says of one combination: nothing (it composes), or the first problem `defineApp` throws. */
export interface Refusal {
  readonly code: string;
  readonly message: string;
}

/** Composes the skeleton of the combination's site with only that member; `undefined` when it composes. */
export function refusalOf(combo: Combo): Refusal | undefined {
  const member = memberOf(combo, personalAt(combo.site), otherAt(combo.site));
  try {
    skeletonApp(combo.site, { [combo.name]: member });
    return undefined;
  } catch (error) {
    const details = (error as { details?: { code?: string } }).details;
    return { code: details?.code ?? 'none', message: (error as Error).message };
  }
}
