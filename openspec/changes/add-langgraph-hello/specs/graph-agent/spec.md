# Spec: graph-agent

## ADDED Requirements

### Requirement: The pipeline is a LangGraph StateGraph with one conditional edge
The agent SHALL be a LangGraph `StateGraph` with nodes `normalize`,
`echo_empty`, `analyze`, `probe`, `assemble`, and exactly one conditional edge
routing on whether the normalized input is empty. State SHALL be pydantic.
LangChain chain and agent abstractions SHALL NOT be used and `langchain_core`
SHALL NOT be imported (ADR 0003).

#### Scenario: Text input
- **WHEN** non-empty text is submitted
- **THEN** the nodes execute normalize → analyze → probe → assemble and the
  result reports the word count

#### Scenario: Empty input
- **WHEN** empty or whitespace-only input is submitted
- **THEN** the nodes execute normalize → echo_empty → probe → assemble and the
  result reports no input

### Requirement: No LLM, no network, no secrets
The agent SHALL NOT call any LLM, SHALL NOT require network access, and SHALL
NOT require any API key or secret. Its only configuration SHALL be an input
size cap read from the environment.

#### Scenario: Runs fully offline
- **WHEN** the agent runs with no network and no environment secrets
- **THEN** it completes normally and returns a result

### Requirement: The probe reports the running environment
The agent SHALL expose the environment it runs in — at minimum hostname,
kernel release, machine architecture, cpu count, and pid — via a `probe` node
and a `GET /whoami` endpoint, so that when run inside a Firecracker microVM the
reported values are the guest's and thereby evidence the microVM booted and is
isolated.

#### Scenario: whoami inside a microVM
- **WHEN** the image is booted as a Firecracker microVM and `GET /whoami` is
  called from the host
- **THEN** the returned kernel, hostname, and IP are the guest VM's, not the
  host's

### Requirement: REST surface
The agent SHALL expose `GET /healthz` (readiness), `POST /run` (run one input
through the graph synchronously and return the state), and `GET /whoami` (the
probe). The graph SHALL be compiled once at startup, not per request.

#### Scenario: Synchronous run
- **WHEN** `POST /run` is called with text
- **THEN** the response returns the full graph state including the visit trace,
  stats, env, and result, without an async job step
