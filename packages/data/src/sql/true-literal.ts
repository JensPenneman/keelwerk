import { sql } from 'kysely';
import type { CompiledPredicate } from './compile-condition.ts';

export const trueLiteral: CompiledPredicate = { expression: sql<boolean>`true`, nullable: false };
