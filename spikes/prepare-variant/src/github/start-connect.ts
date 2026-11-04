import { defineCommand, field, shape } from '@keelwerk/core';
import { githubBase } from './github-base.ts';

/** Opens a connection start: the state GitHub later hands back with the code. */
export const startConnect = defineCommand(githubBase, {
  input: shape({ state: field.string({ maxLength: 64 }) }),
  auth: { public: true },
  decide: (input, ctx) => [ctx.write.github.pendingConnect.create({ state: input.state })],
});
