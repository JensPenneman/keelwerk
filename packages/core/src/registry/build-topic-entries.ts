import type { Shape } from '../fields/shape.ts';
import type { ActionHandler } from './action-handler.ts';
import type { RuntimeModule } from './runtime-module.ts';
import type { TopicEntry } from './topic-entry.ts';

interface TopicSpecView {
  readonly key: Shape;
  readonly record: Shape;
  readonly onFirstSubscriber?: ActionHandler;
  readonly onLastSubscriberLeft?: ActionHandler;
}

/** The topics the modules mount, by reference. */
export function buildTopicEntries(
  ordered: readonly RuntimeModule[],
): ReadonlyMap<string, TopicEntry> {
  const topics = new Map<string, TopicEntry>();
  for (const module of ordered) {
    for (const [name, part] of Object.entries(module.topics)) {
      const ref = `${module.id}.${name}`;
      const spec = Reflect.get(part, 'spec') as TopicSpecView;
      topics.set(ref, {
        ref,
        module: module.id,
        name,
        key: spec.key,
        record: spec.record,
        ...(spec.onFirstSubscriber === undefined
          ? {}
          : { onFirstSubscriber: spec.onFirstSubscriber }),
        ...(spec.onLastSubscriberLeft === undefined
          ? {}
          : { onLastSubscriberLeft: spec.onLastSubscriberLeft }),
      });
    }
  }
  return topics;
}
