import type { Shape } from '../fields/shape.ts';
import type { ActionHandler } from './action-handler.ts';

/** A topic a module declares (G6): never stored; subscribers per key. */
export interface TopicEntry {
  /** '<module>.<name>'. */
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  readonly key: Shape;
  readonly record: Shape;
  readonly onFirstSubscriber?: ActionHandler;
  readonly onLastSubscriberLeft?: ActionHandler;
}
