import { expect } from 'vitest';

export const refused = expect.objectContaining({ kind: 'forbidden', code: 'core.forbidden' });
