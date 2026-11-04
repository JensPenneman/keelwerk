import { actionTemplate } from './action-template.ts';
import { appTemplate } from './app-template.ts';
import { conditionTemplate } from './condition-template.ts';
import { contributionTemplate } from './contribution-template.ts';
import { effectTemplate } from './effect-template.ts';
import { entityTemplate } from './entity-template.ts';
import { errorTemplate } from './error-template.ts';
import { executorTemplate } from './executor-template.ts';
import { flagTemplate } from './flag-template.ts';
import { libTemplate } from './lib-template.ts';
import { moduleTemplate } from './module-template.ts';
import type { NewKind } from './new-kind.ts';
import { reactionTemplate } from './reaction-template.ts';
import { ruleTemplate } from './rule-template.ts';
import type { ScaffoldPlan } from './scaffold-plan.ts';
import type { ScaffoldRequest } from './scaffold-request.ts';
import { scheduleTemplate } from './schedule-template.ts';
import { scriptTemplate } from './script-template.ts';
import { serviceTemplate } from './service-template.ts';
import { shapeTemplate } from './shape-template.ts';

const templates: Readonly<Record<NewKind, (request: ScaffoldRequest) => ScaffoldPlan>> = {
  module: moduleTemplate,
  entity: entityTemplate,
  action: actionTemplate,
  rule: ruleTemplate,
  flag: flagTemplate,
  error: errorTemplate,
  service: serviceTemplate,
  reaction: reactionTemplate,
  contribution: contributionTemplate,
  condition: conditionTemplate,
  lib: libTemplate,
  shape: shapeTemplate,
  effect: effectTemplate,
  executor: executorTemplate,
  schedule: scheduleTemplate,
  app: appTemplate,
  script: scriptTemplate,
};

/** The files and hand edits of one scaffold. */
export function planScaffold(request: ScaffoldRequest): ScaffoldPlan {
  return templates[request.kind](request);
}
