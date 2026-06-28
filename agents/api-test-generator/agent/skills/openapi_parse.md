---
description: How to interpret the endpoint model produced by parse_openapi, and what to pass subagents.
---

# Skill: OpenAPI Parse — Endpoint Model Reference

Load this skill when interpreting the output of `parse_openapi` or when
deciding what context to pass to the Pairwise Designer.

## Endpoint model shape

Each entry in `endpoint_model.json` represents one API operation:

```jsonc
{
  "operationId": "listPets",           // unique key across the spec
  "method": "GET",                     // uppercase HTTP method
  "path": "/pets",                     // path with {param} placeholders
  "tag": "pets",                       // first OpenAPI tag (used for folder)
  "summary": "List all pets",
  "description": "...",
  "deprecated": false,
  "parameters": [
    {
      "name": "limit",
      "in": "query",                   // query | path | header | cookie
      "required": false,
      "schema": { "type": "integer", "minimum": 1, "maximum": 100 },
      "description": "Maximum items to return"
    }
  ],
  "requestBody": {
    "required": true,
    "content_type": "application/json",
    "schema": { "...": "..." },
    "example": { "name": "Fido", "tag": "dog" }
  },
  "responses": {
    "200": {
      "description": "OK",
      "content_type": "application/json",
      "schema": { "...": "..." },
      "example": { "...": "..." }
    },
    "400": { "description": "Bad request", "content_type": "application/json" },
    "401": { "description": "Unauthorized", "content_type": "text/html" },
    "default": { "description": "Unexpected error", "content_type": "application/json" }
  },
  "security": ["bearerAuth"]           // security scheme names applied to this op
}
```

## What to pass the Pairwise Designer

Send the **full `endpoint_model.json` content** inline in the delegation message —
the Pairwise Designer has an isolated sandbox and cannot read files. Include:

- All endpoints in the model.
- Auth profile (from options or `.env`).
- Pairwise strength override if provided (default 2).
- Any organization-specific role names or permission levels.

## What to pass the Assertion Writer

Send the **named endpoint model** (after `apply_naming_rules`) and the first 3
rows of the pairwise matrix per endpoint to give context. Provide:

- Request name → method/path/responses mapping.
- Auth profile (so it generates the right credential keys).
- Base URL variable name.

## Warnings to surface

The `parse_openapi` tool emits warnings for:
- Endpoints missing `operationId` (auto-assigned as `<method>_<path>_<idx>`).
- Unresolvable `$ref` (those endpoints are skipped with a warning).
- Deprecated operations (included with `deprecated: true`).
- Missing response examples (Assertion Writer will infer from schema).

Surface all warnings in the final summary to the user.
