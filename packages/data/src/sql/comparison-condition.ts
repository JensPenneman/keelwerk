import type { Condition } from '@keelwerk/core';

export type ComparisonCondition = Extract<Condition, { readonly field: string }>;
