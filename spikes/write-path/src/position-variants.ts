import type { AppendRequest } from './append-request.ts';

/** How a decision's loads learn their snapshot position (section 7.9.4 phase 5, 26.2 item 6). */
export const positionVariants: Readonly<
  Record<
    | 'read committed, plain loads'
    | 'read committed, positioned loads'
    | 'read committed, positioned, target after lock'
    | 'repeatable read',
    Pick<AppendRequest, 'isolation' | 'positionedLoads' | 'targetPosition'>
  >
> = {
  'read committed, plain loads': {
    isolation: 'read committed',
    positionedLoads: false,
    targetPosition: 'same-statement',
  },
  'read committed, positioned loads': {
    isolation: 'read committed',
    positionedLoads: true,
    targetPosition: 'same-statement',
  },
  'read committed, positioned, target after lock': {
    isolation: 'read committed',
    positionedLoads: true,
    targetPosition: 'after-lock',
  },
  'repeatable read': {
    isolation: 'repeatable read',
    positionedLoads: false,
    targetPosition: 'same-statement',
  },
};
