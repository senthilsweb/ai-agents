# LinkedIn Cover Agent Specification

## Requirement: Input sources
The agent SHALL accept a local article path, an HTTP/HTTPS URL, or inline article text.

## Requirement: Canvas
The default canvas SHALL be 1279x720. Named presets and explicit WIDTHxHEIGHT values SHALL be supported.

## Requirement: Minimal model calls
A normal run SHALL use no more than one orchestrator reasoning call and one image generation call. Review SHALL be opt-in and limited to one call.

## Requirement: No unbounded loops
The agent SHALL NOT perform open-ended regeneration. A retry SHALL be opt-in, hard-failure-only, and limited to one.

## Requirement: Brand safety
Company names, product names, logos, and links SHALL be excluded unless explicitly requested.

## Requirement: Deterministic validation
The output image dimensions SHALL be validated without an LLM. A mismatch SHALL be reported as a hard failure.

## Requirement: Approval mode
When approval is enabled, the agent SHALL persist a proposal and Cover Spec and stop before image generation.
