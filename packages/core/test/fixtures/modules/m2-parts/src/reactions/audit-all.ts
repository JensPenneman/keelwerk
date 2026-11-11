import { defineReaction } from '@keelwerk/core';
import { m2PartsBase } from '../base.ts';

export const auditAll = defineReaction(m2PartsBase, {
  on: 'all',
  except: ['m2-parts.task.renamed'],
  react: () => ({ events: [] }),
});
