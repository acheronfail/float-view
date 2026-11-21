# Design

## Context

Build apps prepares one source, version and build number before running independent sideload and protected store jobs. GitHub publication currently expects all three sideload artifacts.

## Goals / Non-Goals

Honor per-platform opt-outs on master, stable and candidate runs, including manual dispatches of the same source. Keep existing tag, signing and delivery gates for enabled platforms. GitHub's built-in `[skip ci]` behavior stays under GitHub's control.

## Decisions

- Read exact lowercase markers from the full message of the checked-out commit. Earlier commits and tag annotations have no effect. Preparation and publication resolve the same selection from the same immutable source.
- Gate each sideload and store job on its platform. Publication accepts skipped dependencies only for omitted platforms, downloads only enabled artifacts and requires every enabled platform to succeed.
- Keep partial stable releases out of the Latest designation so users of omitted platforms can still find the previous complete release. Nightly continues to represent one source and its selected asset set.

## Risks / Trade-offs

A manual rerun of a marked tag still omits those platforms. A later tag at an unmarked commit can build them. A partial release uses the same version and build numbering as a complete run.
