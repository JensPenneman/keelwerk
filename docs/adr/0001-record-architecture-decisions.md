# 1. Record architecture decisions

Date: 2026-10-08 (revised 2026-10-11)

## Status

Accepted (2026-11-04)

## Context

keelwerk is designed and built by several people and agents working in parallel against one
specification, [architecture.md](../architecture.md), from one requirements source,
[brief.md](../brief.md). The brief is appended over time and explicitly asks that a change to the
kernel be recorded. The specification says what the framework is; it does not record why a
choice was made, which alternatives were rejected, or how an ambiguity was settled. Without that
record, decisions are re-argued or reversed by someone who never saw the reason.

## Decision

We record architecturally significant decisions as Architecture Decision Records in the form
described by Michael Nygard: title, date, status, context, decision, consequences.

- ADRs live in `docs/adr/` as `NNNN-short-title.md`, numbered in sequence. Numbers are never
  reused.
- A decision is significant when it shapes the composition model, a public interface (the DSL,
  the action registry, the transport or adapter contracts, the CLI, stored formats, the wire
  formats), the security or isolation model, the execution model, or the toolchain, or when it
  is expensive to reverse.
- The status is `Proposed`, `Accepted`, `Deprecated` or `Superseded by NNNN`. An accepted ADR is
  not rewritten: changing a decision means a new ADR that supersedes the old one. Typos and
  links may be fixed.
- During the architecture phase, until Jens approves the architecture, every ADR is `Proposed`
  and is edited in place when review changes its decision, together with `architecture.md`.
  Jens's approval sets the approved ADRs to `Accepted`; from then on the supersede rule applies.
- An ADR is added in the change that makes the decision. When a decision changes the
  specification, the same change updates `architecture.md`.
- `architecture.md` remains the specification; ADRs explain it and settle its open points and
  never contradict it.
- Every change to the kernel (the composition rules, the pipeline, the scope and principal
  model, the condition AST, the error taxonomy) requires an ADR, as the brief's second addendum
  asks.
- Number ranges of the first design round: 0002 to 0005 record the core decisions; 0006 to 0009
  the data layer; 0010 to 0013 interfaces and developer experience; 0014 and 0015 the
  authentication module and the job queue, added by the consolidation of 2026-10-11. Later ADRs
  continue from 0016 in any area; the roadmap names the ADRs that must exist before each
  milestone.
- Absolute dates everywhere; no relative time references.

## Consequences

- The reasoning behind the main choices is findable without reading history or research notes.
- Each significant decision costs a short document; a reviewer asks for one when a change makes
  such a decision without it.
- Superseded ADRs stay, so the history of a decision remains readable once ADRs are accepted;
  during the architecture phase, git history keeps the earlier wording.
- The parallel designers can write their ADRs without coordinating numbers.
