# Project: job-search-pipeline

## Purpose
Deterministic-first pipeline for sourcing, verifying, scoring, and tracking
senior data-governance / engineering-leadership job opportunities, with an
optional agentic layer for search execution. Built per AI-DLC: specs drive
code; typed/deterministic tools do the work; models only coordinate.

## Tech Stack
- Python 3.11+, marimo (reactive notebook), DuckDB (storage + views)
- PyYAML config; python-dotenv for secrets; Anthropic API (optional agentic layer)

## Conventions
- All tunables in config.yaml; secrets only in .env
- Schema changes are idempotent DDL mirrored in openspec/specs/data-model
- Never fabricate req IDs, salaries, or contacts; unknown = NULL + note
- Personal contact data (email/phone) is user-supplied only, never scraped
