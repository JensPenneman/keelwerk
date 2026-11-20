/** How long past its timeout the guard job of an inline run waits before it settles a run that was cut; also the slack past a command's `timeoutMs` before a row without a receipt can no longer belong to a live run. */
export const inlineGuardGraceMs = 60_000;
