import { expectTypeOf, test } from 'vitest';
import type { ActorRef } from '../principals/actor-ref.ts';
import type { JobAttempt } from '../storage/job-attempt.ts';
import type { Job } from './job.ts';
import type { JobExplanation } from './job-explanation.ts';
import type { JobQueue } from './job-queue.ts';
import type { QueueCapabilities } from './queue-capabilities.ts';
import type { QueuePause } from './queue-pause.ts';
import type { WorkerOptions } from './worker-options.ts';

test('JobQueue.work takes a Job handler and WorkerOptions', () => {
  expectTypeOf<Parameters<JobQueue['work']>[1]>().toEqualTypeOf<(job: Job) => Promise<void>>();
  expectTypeOf<Parameters<JobQueue['work']>[2]>().toEqualTypeOf<WorkerOptions>();
});

test('JobExplanation is exhaustive in a switch', () => {
  function describeState(explanation: JobExplanation): string {
    switch (explanation.state) {
      case 'scheduled':
      case 'available':
      case 'waiting':
      case 'running':
      case 'dead':
      case 'gone':
        return explanation.state;
      default: {
        const unreachable: never = explanation;
        return unreachable;
      }
    }
  }
  expectTypeOf(describeState).returns.toEqualTypeOf<string>();
});

test('an available job waits for one of seven reasons', () => {
  expectTypeOf<Extract<JobExplanation, { state: 'available' }>['waitingFor']>().toEqualTypeOf<
    'cap' | 'group' | 'rate' | 'capability' | 'revision' | 'slot' | 'paused'
  >();
});

test('a gone job never reports a retry', () => {
  expectTypeOf<Extract<JobExplanation, { state: 'gone' }>['outcome']>().toEqualTypeOf<
    'succeeded' | 'dead' | 'failed' | undefined
  >();
});

test('Job reads its attempt from the stored job', () => {
  expectTypeOf<Job['stored']['attempt']>().toEqualTypeOf<JobAttempt>();
  expectTypeOf<'attempt'>().not.toExtend<keyof Job>();
});

test('JobQueue reports its capabilities', () => {
  expectTypeOf<JobQueue['capabilities']>().toEqualTypeOf<QueueCapabilities>();
});

test('QueuePause names its namespace, its scope and who paused', () => {
  expectTypeOf<QueuePause['namespaceId']>().toEqualTypeOf<string | null>();
  expectTypeOf<QueuePause['scopeId']>().toEqualTypeOf<string | null>();
  expectTypeOf<QueuePause['pausedBy']>().toEqualTypeOf<ActorRef>();
});
