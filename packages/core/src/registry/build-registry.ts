import { applyConditionals } from './apply-conditionals.ts';
import { applyContributions } from './apply-contributions.ts';
import { bindExtensionFills } from './bind-extension-fills.ts';
import { buildActionTable } from './build-action-table.ts';
import { buildContributionEntries } from './build-contribution-entries.ts';
import { buildEffectEntries } from './build-effect-entries.ts';
import { buildEntities } from './build-entities.ts';
import { buildExecutorEntries } from './build-executor-entries.ts';
import { buildExtensionPoints } from './build-extension-points.ts';
import { buildHookEntries } from './build-hook-entries.ts';
import { buildModuleEntries } from './build-module-entries.ts';
import { buildQuotaEntries } from './build-quota-entries.ts';
import { buildReactionEntries } from './build-reaction-entries.ts';
import { buildRuleSet } from './build-rule-set.ts';
import { buildScheduleEntries } from './build-schedule-entries.ts';
import { buildServiceEntries } from './build-service-entries.ts';
import { buildStreamEntries } from './build-stream-entries.ts';
import { buildTopicEntries } from './build-topic-entries.ts';
import { buildVersionChangeEntries } from './build-version-change-entries.ts';
import { checkActionNames } from './check-action-names.ts';
import { checkCamelCaseCollisions } from './check-camel-case-collisions.ts';
import { checkColumnCollisions } from './check-column-collisions.ts';
import { checkConflictingFields } from './check-conflicting-fields.ts';
import { checkContributedFieldsNeedDefault } from './check-contributed-fields-need-default.ts';
import { checkContributionsOutsideDependencies } from './check-contributions-outside-dependencies.ts';
import { checkDanglingReferences } from './check-dangling-references.ts';
import { checkDuplicateIds } from './check-duplicate-ids.ts';
import { checkDuplicatePrefixes } from './check-duplicate-prefixes.ts';
import { checkEventNames } from './check-event-names.ts';
import { checkExecutorsWithoutEffect } from './check-executors-without-effect.ts';
import { checkIdentifierGrammar } from './check-identifier-grammar.ts';
import { checkMissingModules } from './check-missing-modules.ts';
import { checkOfflineCommands } from './check-offline-commands.ts';
import { checkPersonalCommandOutput } from './check-personal-command-output.ts';
import { checkPrepareCommands } from './check-prepare-commands.ts';
import { checkReadRuleFields } from './check-read-rule-fields.ts';
import { checkRefsOutsideRequirements } from './check-refs-outside-requirements.ts';
import { checkRelationNames } from './check-relation-names.ts';
import { checkReservedNames } from './check-reserved-names.ts';
import { checkTableCollisions } from './check-table-collisions.ts';
import { checkUnknownConditionFields } from './check-unknown-condition-fields.ts';
import { checkUnknownConditionTargets } from './check-unknown-condition-targets.ts';
import { checkUnknownContributionTargets } from './check-unknown-contribution-targets.ts';
import { checkUnknownExecutionOverrides } from './check-unknown-execution-overrides.ts';
import { checkUnknownPolicyTargets } from './check-unknown-policy-targets.ts';
import { checkUnknownRuleActions } from './check-unknown-rule-actions.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { orderModules } from './order-modules.ts';
import type { Registry } from './registry.ts';
import { selectModules } from './select-modules.ts';
import { sortedMap } from './sorted-map.ts';

/** Problems that make the selection itself unusable: nothing else can be derived from it. */
const structural: ReadonlySet<string> = new Set([
  'missingModules',
  'duplicateModuleIds',
  'reservedModuleIds',
  'invalidModuleIds',
  'invalidAppId',
  'camelCaseCollisions',
  'dependencyCycles',
]);

function emptyRegistry(app: string, problems: readonly CompositionProblem[]): Registry {
  const none = new Map<never, never>();
  return {
    app,
    modules: [],
    entities: none,
    actions: none,
    rules: none,
    reactions: none,
    hooks: none,
    services: none,
    effects: none,
    executors: none,
    schedules: none,
    streams: none,
    topics: none,
    versionChanges: none,
    quotas: none,
    extensionPoints: none,
    fills: none,
    contributions: [],
    problems,
  };
}

/**
 * Builds the registry of an app (sections 3.3 and 4.7): orders the modules, applies contributions
 * and conditional parts, derives entity descriptors, the action table, the rule set and the bound
 * fills, and mirrors every named check at runtime as `CompositionProblem` values. Pure: no I/O.
 * An app with a structural problem (a missing or duplicated module, a bad id, a cycle) gets an empty
 * registry and the problems; any other problem leaves the registry whole beside it.
 */
export function buildRegistry(app: ComposableApp): Registry {
  const selection = selectModules(app);
  const { ordered, cyclic } = orderModules(selection);
  const parts = [
    ...applyContributions(selection, ordered),
    ...applyConditionals(selection, ordered),
  ];
  const problems: CompositionProblem[] = [
    ...checkMissingModules(selection),
    ...checkDuplicateIds(selection, parts),
    ...checkReservedNames(selection, parts),
    ...checkIdentifierGrammar(app, selection, parts),
    ...checkActionNames(app, selection, parts),
    ...checkRelationNames(selection, parts),
    ...checkEventNames(selection),
    ...checkCamelCaseCollisions(selection),
    ...cyclic.map((id) =>
      compositionError('dependencyCycles', `Module '${id}' is on a dependency cycle.`, {
        module: id,
        ref: id,
      }),
    ),
    ...checkRefsOutsideRequirements(selection),
    ...checkContributedFieldsNeedDefault(selection),
    ...checkContributionsOutsideDependencies(selection),
    ...checkUnknownConditionTargets(selection),
    ...checkExecutorsWithoutEffect(selection),
    ...checkUnknownRuleActions(selection),
    ...checkUnknownPolicyTargets(selection),
  ];
  if (problems.some((problem) => problem.severity === 'error' && structural.has(problem.code))) {
    return emptyRegistry(app.id, problems);
  }
  problems.push(
    ...checkUnknownContributionTargets(selection, parts),
    ...checkConflictingFields(selection, parts),
    ...checkDuplicatePrefixes(selection),
    ...checkDanglingReferences(selection, parts),
  );
  const entities = buildEntities(selection, ordered, parts);
  const table = buildActionTable(app, ordered, parts, entities);
  const ruleSet = buildRuleSet(app, ordered, parts, {
    actions: table.actions,
    entities: sortedMap([...entities].map(([ref, model]) => [ref, model.entry])),
  });
  const built = buildReactionEntries(ordered, parts);
  const reactions = built.reactions;
  const builtHooks = buildHookEntries(ordered);
  const hooks = builtHooks.hooks;
  const services = buildServiceEntries(ordered);
  const points = buildExtensionPoints(ordered);
  const bound = bindExtensionFills(ordered, parts, points);
  const scheduleTable = buildScheduleEntries(ordered, table.actions);
  problems.push(
    ...table.problems,
    ...ruleSet.problems,
    ...built.problems,
    ...builtHooks.problems,
    ...bound.problems,
    ...scheduleTable.problems,
    ...checkColumnCollisions(entities),
    ...checkTableCollisions(entities),
    ...checkUnknownExecutionOverrides(app, table.actions),
    ...checkReadRuleFields(ruleSet.rules, entities),
    ...checkUnknownConditionFields(ruleSet.rules, entities),
    ...checkOfflineCommands(table.actions),
    ...checkPersonalCommandOutput(table.actions),
    ...checkPrepareCommands(table.actions),
  );
  return {
    app: app.id,
    modules: buildModuleEntries(ordered, {
      entities,
      actions: table.actions,
      rules: ruleSet.rules,
      reactions,
      hooks,
      services,
      extensionPoints: points,
    }),
    entities: sortedMap([...entities].map(([ref, model]) => [ref, model.entry])),
    actions: sortedMap(table.actions),
    rules: sortedMap(ruleSet.rules),
    reactions: sortedMap(reactions),
    hooks: sortedMap(hooks),
    services: sortedMap(services),
    effects: sortedMap(buildEffectEntries(ordered)),
    executors: sortedMap(buildExecutorEntries(ordered)),
    schedules: sortedMap(scheduleTable.schedules),
    streams: sortedMap(buildStreamEntries(ordered)),
    topics: sortedMap(buildTopicEntries(ordered)),
    versionChanges: sortedMap(buildVersionChangeEntries(ordered)),
    quotas: sortedMap(buildQuotaEntries(ordered)),
    extensionPoints: sortedMap(points),
    fills: sortedMap(bound.fills),
    contributions: buildContributionEntries(parts),
    problems,
  };
}
