import type { InputOf } from '@keelwerk/client';
import type { AppType } from '@keelwerk/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { cardBoardApp } from './support/card-board-kit.ts';

interface CardBoard extends AppType<typeof cardBoardApp> {}

describe('the patch of a generated update (section 6.7)', () => {
  type Update = InputOf<CardBoard, 'board.card.update'>;

  test('no member of a patch is required, a defaulted one included', () => {
    expectTypeOf<Update['patch']>().toHaveProperty('shown');
    expectTypeOf<Update['patch']['shown']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Record<string, never>>().toExtend<Update['patch']>();
    expectTypeOf<{ readonly title: string }>().toExtend<Update['patch']>();
  });

  test('a create leaves out a defaulted member and requires the others', () => {
    type Create = InputOf<CardBoard, 'board.card.create'>;
    expectTypeOf<{ readonly owner: string; readonly title: string }>().toExtend<Create>();
    expectTypeOf<{ readonly title: string }>().not.toExtend<Create>();
  });
});
