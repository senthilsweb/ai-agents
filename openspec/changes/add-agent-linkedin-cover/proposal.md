# Proposal: Add `agent-linkedin-cover`

## Why
The repository needs a repeatable LinkedIn cover generator that captures established editorial layout, color, safe-zone, dimension, brand-safety, and low-token execution requirements.

## What changes
- Add an Eve agent at `agents/agent-linkedin-cover/`.
- Accept local article paths, remote URLs, or inline text.
- Default to 1279x720 and support named/custom size presets.
- Use one orchestrator planning call and one powerful image generation call.
- Use deterministic prompt construction, output validation, and reporting.
- Disable automatic review and retry loops by default.
- Exclude employer/product branding unless explicitly requested.

## Impact
Adds one npm workspace package and image-processing dependencies (`sharp`, Readability/JSDOM, gray-matter). No changes to the existing diagram generator.
