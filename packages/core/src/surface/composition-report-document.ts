import type { CompositionProblem } from '../registry/composition-problem.ts';
import type { RuleEntry } from '../registry/rule-entry.ts';

/** One module of the report: what it needs and what it offers. */
export interface CompositionModuleReport {
  readonly id: string;
  readonly version: string;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly provides: readonly string[];
  readonly needs: readonly string[];
}

/** A contribution or a conditional part, active or dropped with the reason (section 16.2.6). */
export interface CompositionContributionReport {
  /** 'auth->accounts' for a contribution, 'auth[accounts]' for a conditional part. */
  readonly id: string;
  readonly kind: 'contribution' | 'conditional';
  readonly from: string;
  readonly to: string;
  readonly when: readonly string[];
  readonly active: boolean;
  readonly droppedBecause?: 'targetAbsent' | 'whenUnsatisfied';
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly actions: readonly string[];
  readonly rules: readonly string[];
  readonly reactions: readonly string[];
  readonly fills: readonly string[];
}

/** An extension point and the modules that fill it, in fill order. */
export interface CompositionExtensionPointReport {
  readonly ref: string;
  readonly module: string;
  readonly name: string;
  readonly mode: 'set' | 'ordered' | 'single';
  readonly min?: number;
  readonly hasDefault: boolean;
  readonly fillers: readonly {
    readonly module: string;
    readonly bound: boolean;
    readonly order?: number;
  }[];
}

/** An effective policy rule; the conditions are listed by which callbacks the rule has, because rendering them needs a principal (`ability.explain`). */
export interface CompositionRuleReport {
  readonly id: string;
  readonly module: string;
  readonly effect: RuleEntry['effect'];
  readonly subject: RuleEntry['subject'];
  readonly actions: readonly string[];
  readonly principal?: RuleEntry['principal'];
  readonly fields?: readonly string[];
  readonly reason?: string;
  readonly contributedBy?: string;
  readonly disabled: boolean;
  readonly conditions: {
    readonly where: boolean;
    readonly check: boolean;
    readonly when: boolean;
  };
}

/** What the surface leaves out (section 16.2.6): the answer of `core.composition`. */
export interface CompositionReportDocument {
  readonly format: 'keelwerk.composition/1';
  readonly app: string;
  /** Sorted by id. */
  readonly modules: readonly CompositionModuleReport[];
  /** Sorted by id. */
  readonly contributions: readonly CompositionContributionReport[];
  /** Sorted by reference. */
  readonly extensionPoints: readonly CompositionExtensionPointReport[];
  /** Sorted by id. */
  readonly rules: readonly CompositionRuleReport[];
  /** Sorted by code, then reference. */
  readonly problems: readonly CompositionProblem[];
}
