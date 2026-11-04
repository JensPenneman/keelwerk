import { sql } from 'kysely';
import type { CompiledPredicate } from './compile-condition.ts';

export const falseLiteral: CompiledPredicate = { expression: sql<boolean>`false`, nullable: false };
