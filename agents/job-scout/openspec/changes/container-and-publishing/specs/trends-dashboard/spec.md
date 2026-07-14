# Spec: trends dashboard (delta)

## MODIFIED Requirement: Method notes behind a help slide-over
The dashboard SHALL present its help in a right slide-over panel opened
by a help icon (inline SVG question mark) in the header — written in
plain English (simple words, no idioms, terms defined in place) and
organized for three audiences: *Reading this dashboard* (end users),
*Using the data* (analysts/data engineers — public URL, copy-paste
DuckDB query, tag-based history, column guide), and *Run it yourself*
(developers — docker one-liner, repo link, keyword config) — instead of
an inline block. ESC, the shade, and a close button SHALL dismiss it;
the JD drawer and help panel share the shade and never stack.

#### Scenario: Help on demand
- **WHEN** the help icon is clicked
- **THEN** the slide-over opens with the grouped bullets, and the main
  page contains no inline method section

#### Scenario: Keyboard dismiss
- **WHEN** ESC is pressed while the help panel is open
- **THEN** it closes (same for the JD drawer)
