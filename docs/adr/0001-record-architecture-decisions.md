# 1. Record architecture decisions

Date: 2026-10-08

## Status

Accepted

## Context

pennestack is designed and built by several people and agents working in parallel against one
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
- An ADR is added in the change that makes the decision. When a decision changes the
  specification, the same change updates `architecture.md`.
- `architecture.md` remains the specification; ADRs explain it and settle its open points and
  never contradict it.
- Every change to the kernel (the composition rules, the pipeline, the scope and principal
  model, the condition AST, the error taxonomy) requires an ADR, as the brief's second addendum
  asks.
- Number ranges for the first design round: 0002 to 0005 record the core decisions; 0006 to 0009
  are reserved for the data layer; 0010 to 0013 are reserved for interfaces and developer
  experience. Later ADRs continue from 0014 in any area.
- Absolute dates everywhere; no relative time references.

## Consequences

- The reasoning behind the main choices is findable without reading history or research notes.
- Each significant decision costs a short document; a reviewer asks for one when a change makes
  such a decision without it.
- Superseded ADRs stay, so the history of a decision remains readable.
- The parallel designers can write their ADRs without coordinating numbers.
