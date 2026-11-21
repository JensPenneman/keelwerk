import { afterEach } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { jobStoreReleaseCases } from './job-store-release-cases.ts';
import { queueScenarioKeyCases } from './queue-scenario-key-cases.ts';
import type { QueueScenarioKit } from './queue-scenario-kit.ts';
import { queueScenarioKit } from './queue-scenario-kit.ts';
import { queueScenarioLeaseCases } from './queue-scenario-lease-cases.ts';
import { queueScenarioOrderCases } from './queue-scenario-order-cases.ts';
import { queueScenarioReceiptCases } from './queue-scenario-receipt-cases.ts';
import { queueScenarioRetryCases } from './queue-scenario-retry-cases.ts';

/** The queue scenarios of 14.3.9 and 14.10 case 10 through the kernel queue; a kit per case, closed in afterEach. */
export function queueScenarioCases(subject: ConformanceSubject): void {
  let current: QueueScenarioKit | undefined;
  const kit = (): QueueScenarioKit => {
    current ??= queueScenarioKit(subject);
    return current;
  };
  afterEach(async () => {
    const finished = current;
    current = undefined;
    await finished?.close();
  });
  queueScenarioKeyCases(kit);
  queueScenarioOrderCases(kit, subject);
  queueScenarioRetryCases(kit, subject);
  queueScenarioLeaseCases(kit, subject);
  queueScenarioReceiptCases(kit, subject);
  jobStoreReleaseCases(subject);
}
