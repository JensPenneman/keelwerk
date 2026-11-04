import type { ArchiveDraft } from './archive-draft.ts';
import type { CreateDraft } from './create-draft.ts';
import type { EventDraft } from './event-draft.ts';
import type { RestoreDraft } from './restore-draft.ts';
import type { UpdateDraft } from './update-draft.ts';

/** Every draft the kernel applies, narrowed by `kind`. */
export type AnyDraft = CreateDraft | UpdateDraft | ArchiveDraft | RestoreDraft | EventDraft;
