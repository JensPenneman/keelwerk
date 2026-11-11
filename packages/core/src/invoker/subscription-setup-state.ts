import type { VersionTranslation } from '../api-versions/version-translation.ts';
import type { RuleMatch } from '../errors/rule-match.ts';
import type { Logger } from '../observability/logger.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { InvokerStage } from './decision-hook.ts';

/** What setup leaves behind for the decision hook and for the error a failure is turned into. */
export interface SubscriptionSetupState {
  action?: ActionEntry;
  translation?: VersionTranslation;
  rules?: readonly RuleMatch[];
  stage: InvokerStage;
  log: Logger;
}
