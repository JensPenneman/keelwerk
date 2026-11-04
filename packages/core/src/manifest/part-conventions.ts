/** The kind of part a directory of `src/` holds (section 23.5). */
export type PartKind =
  | 'action'
  | 'change'
  | 'effect'
  | 'executor'
  | 'fill'
  | 'hook'
  | 'policy'
  | 'reaction'
  | 'schedule'
  | 'service'
  | 'topic';

/** Where one directory of `src/` mounts its parts in the module literal. */
export interface PartConvention {
  readonly directory: string;
  readonly kind: PartKind;
  /** The literal section of a part directly in the directory. */
  readonly section: string;
  /** The literal section of a part in a subdirectory named after its owner, when there is one. */
  readonly ownedSection: string | undefined;
  /** What the export's name adds to the file name's camel case (`pollReleasesSchedule`). */
  readonly suffix: string;
  /** Whether the directory is read directly under `src/`. */
  readonly module: boolean;
  /** Whether the directory is read inside `contributions/<d>/` and `conditional/<d>/`. */
  readonly scoped: boolean;
}

/** The table of section 23.5: which directory mounts which part where. */
export const partConventions: readonly PartConvention[] = [
  {
    directory: 'actions',
    kind: 'action',
    section: 'actions',
    ownedSection: 'entityActions',
    suffix: '',
    module: true,
    scoped: true,
  },
  {
    directory: 'policies',
    kind: 'policy',
    section: 'policies',
    ownedSection: 'policies',
    suffix: '',
    module: true,
    scoped: true,
  },
  {
    directory: 'reactions',
    kind: 'reaction',
    section: 'reactions',
    ownedSection: undefined,
    suffix: '',
    module: true,
    scoped: true,
  },
  {
    directory: 'services',
    kind: 'service',
    section: 'services',
    ownedSection: undefined,
    suffix: '',
    module: true,
    scoped: false,
  },
  {
    directory: 'topics',
    kind: 'topic',
    section: 'topics',
    ownedSection: undefined,
    suffix: '',
    module: true,
    scoped: false,
  },
  {
    directory: 'schedules',
    kind: 'schedule',
    section: 'schedules',
    ownedSection: undefined,
    suffix: 'Schedule',
    module: true,
    scoped: false,
  },
  {
    directory: 'lifecycle',
    kind: 'hook',
    section: 'lifecycle',
    ownedSection: undefined,
    suffix: '',
    module: true,
    scoped: false,
  },
  {
    directory: 'versions',
    kind: 'change',
    section: 'changes',
    ownedSection: undefined,
    suffix: '',
    module: true,
    scoped: false,
  },
  {
    directory: 'effects',
    kind: 'effect',
    section: 'effects',
    ownedSection: undefined,
    suffix: '',
    module: true,
    scoped: false,
  },
  {
    directory: 'executors',
    kind: 'executor',
    section: 'executors',
    ownedSection: undefined,
    suffix: '',
    module: true,
    scoped: false,
  },
  {
    directory: 'fills',
    kind: 'fill',
    section: 'extensionPoints',
    ownedSection: undefined,
    suffix: 'Fill',
    module: false,
    scoped: true,
  },
];
