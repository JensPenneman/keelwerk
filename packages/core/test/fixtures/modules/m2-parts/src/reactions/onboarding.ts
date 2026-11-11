import { defineProcess, field, invoke, shape } from '@keelwerk/core';
import { start } from '../actions/start.ts';
import { m2PartsBase } from '../base.ts';

export const onboarding = defineProcess(m2PartsBase, {
  on: ['m2-parts.task.renamed'],
  key: (event) => event.stream.id,
  events: { stepped: shape({ step: field.integer() }) },
  initial: { steps: 0 },
  evolve: (state) => ({ steps: state.steps + 1 }),
  react: (event, state, ctx) => ({
    events: [ctx.events.stepped({ step: state.steps + 1 })],
    effects: [
      invoke(
        start,
        { name: event.data.displayName },
        { errors: { 'm2-parts.start_refused': 'm2-parts.onboarding_failed' } },
      ),
    ],
  }),
});
