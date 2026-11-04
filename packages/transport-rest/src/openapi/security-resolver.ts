import type { PrincipalResolver } from '@keelwerk/core';

/** What the emitter needs of a principal resolver: its id and the description of section 8.5. */
export type SecurityResolver = Pick<PrincipalResolver, 'describe' | 'id'>;
