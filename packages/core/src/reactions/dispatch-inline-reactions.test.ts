import { describe, expect, test, vi } from 'vitest';
import type { EffectScene } from '../effects/effect-scene.ts';
import type { Unit } from '../storage/unit.ts';
import type { RunCommandInput } from '../write-path/run-command-input.ts';
import type { WrittenRow } from '../write-path/written-row.ts';
import { dispatchInlineReactions } from './dispatch-inline-reactions.ts';

const stopped = new Error('the decision opened');
const opened: RunCommandInput[] = [];

vi.mock('./inline-reactions-of.ts', () => ({
  inlineReactionsOf: vi.fn(() => [{ id: 'core.watch', module: 'core', react: vi.fn() }]),
}));
vi.mock('./reaction-events-of.ts', () => ({
  reactionEventsOf: vi.fn(() => [{ id: 'ev1', type: 'core.quota.set' }]),
}));
vi.mock('../registry/reaction-matches.ts', () => ({ reactionMatches: vi.fn(() => true) }));
vi.mock('./module-service-principal.ts', () => ({
  moduleServicePrincipal: vi.fn(() => ({ kind: 'service' })),
}));
vi.mock('./reaction-action-of.ts', () => ({ reactionActionOf: vi.fn(() => ({ ref: 'r' })) }));
vi.mock('../write-path/open-decision.ts', () => ({
  openDecision: vi.fn((input: { run: RunCommandInput }) => {
    opened.push(input.run);
    throw stopped;
  }),
}));

describe('the marks of a command that an inline reaction does not inherit', () => {
  test('the run a reaction decides under carries no quota mark of its command', async () => {
    const scene = {
      unit: {} as Unit,
      run: {
        registry: {},
        action: { ref: 'core.quota.set' },
        principal: { kind: 'user' },
        quotaChecked: true,
      } as unknown as RunCommandInput,
      clock: { now: () => Temporal.Now.instant() },
    } as unknown as EffectScene;
    await expect(dispatchInlineReactions(scene, [] as readonly WrittenRow[])).rejects.toBe(stopped);
    expect(opened).toHaveLength(1);
    expect(opened[0]).not.toHaveProperty('quotaChecked');
    expect(opened[0]?.action).toEqual({ ref: 'r' });
  });
});
