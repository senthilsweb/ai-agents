# Spec: trends dashboard (delta)

## MODIFIED Requirement: Method notes behind a help slide-over
The dashboard SHALL present its method/normalization notes in a right
slide-over panel opened by a help icon (inline SVG question mark) in
the header — concise bullets grouped by topic (source, categories,
salary, target matching, caveats, JDs) — instead of an inline block.
ESC, the shade, and a close button SHALL dismiss it; the JD drawer and
help panel share the shade and never stack.

#### Scenario: Help on demand
- **WHEN** the help icon is clicked
- **THEN** the slide-over opens with the grouped bullets, and the main
  page contains no inline method section

#### Scenario: Keyboard dismiss
- **WHEN** ESC is pressed while the help panel is open
- **THEN** it closes (same for the JD drawer)
