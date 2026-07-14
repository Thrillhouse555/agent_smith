# Phase 1 — Task 2 Setup
## Ollama Integration + 24h Test Run Summary (MVP)

## Objective
Deliver the second working slice of Agent Smith:

1. Reuse the existing local-model execution style used in the previous scoring project.
2. Read Agent Smith chat events from the recent 24 hours.
3. Generate one concise AI summary of test run health.
4. Persist and expose that summary for chat/reporting pages.
5. Run automatically from Jenkins on a schedule or post-test stage.

This task is intentionally simple. It is **summary generation only**, not deep failure diagnosis.

---

## Scope (MVP)
### In scope
- Ollama-backed summariser script for Agent Smith events.
- Pull events from API for last 24h window.
- Hybrid summary logic: deterministic per-test-ID outcome classification + AI narrative text.
- Structured JSON summary output (machine-readable + human-readable).
- Save summary to DB through API endpoint.
- Display latest AI summary in `website/agent-chat.html` as a chat-style timeline message.
- Dedicated Jenkins pipeline using the same startup/readiness pattern as the previous project.

### Out of scope (for this task)
- Root-cause analysis per failed test.
- Flaky test probability models.
- Code-change correlation.
- Auto-remediation suggestions.
- Multi-model orchestration.

---

## Recommended Architecture (using current repo)
- **Data source:** `my-api/index.js` (`/api/agent-smith/messages`).
- **AI runner script:** `agent_smith/review-agent-smith-events.mjs`.
- **Persist script:** `agent_smith/save-agent-smith-summary.mjs`.
- **Storage:** existing `agent_smith_events` table (store summary as an event).
- **Automation:** Jenkins shell stage matching prior `llama-server` flow.

Flow:

```text
Jenkins -> start llama-server -> fetch 24h events -> Ollama summary -> persist summary -> chat/report UI reads latest summary
```

---

## Summary Contract (v1)
The summariser should return JSON only, with this shape:

```json
{
  "window": {
    "from": "2026-07-12T10:00:00Z",
    "to": "2026-07-13T10:00:00Z",
    "hours": 24
  },
  "totals": {
    "tests": 15,
    "events": 62,
    "passed": 14,
    "failed": 1,
    "flaky": 2,
    "warning": 0,
    "info": 0,
    "noTestIdEvents": 4
  },
  "eventTotals": {
    "events": 62,
    "passed": 58,
    "failed": 4,
    "warning": 0,
    "info": 0
  },
  "sources": [
    { "name": "cypress", "events": 70, "failed": 10 },
    { "name": "playwright", "events": 30, "failed": 4 },
    { "name": "serenity", "events": 28, "failed": 4 }
  ],
  "topFailures": [
    {
      "testId": "TST-001",
      "testName": "should login with valid credentials",
      "suite": "Login Suite",
      "failed": 1,
      "passed": 0,
      "classification": "failed",
      "latestMessage": "Timeout waiting for #auth-form"
    }
  ],
  "summaryText": "24h test health is mostly stable with concentrated failures in login and checkout paths.",
  "recommendations": [
    "Review selector stability for repeated timeout failures.",
    "Prioritize top 3 recurring failed tests for triage."
  ],
  "confidence": "medium"
}
```

### Required summary fields
- `window`, `totals`, `summaryText`, `recommendations`, `confidence`.

### Optional summary fields
- `eventTotals`, `sources`, `topFailures`.

### Outcome classification rule (deterministic)
Each unique `testId` in the 24-hour window is classified as:
- `failed`: only failure events, no pass events.
- `passed_flaky`: both pass and failure events.
- `passed`: pass events only.

`totals.passed` includes both stable passed and flaky passed tests.

---

## API Endpoints to Add
### 1) Read events with optional time window
`GET /api/agent-smith/messages?limit=500&hours=24&runId=<optional>&eventType=<optional>`

Behavior:
- Keep existing contract.
- Add `hours` filter for server-side time window (default no filter).
- Add optional `eventType` filter (`test_result` | `summary`).
- Return newest-first.

### 2) Store generated summary
`POST /api/agent-smith/summaries`

Behavior:
- Writes summary into `agent_smith_events` (not a separate summary table).
- Insert with `source: "agent_smith"`, `eventType: "summary"`, `status: "info"`.
- Store `summaryText` in `message_text`.
- Store full summary contract plus model metadata in `metadata_json`.
- Use generation timestamp as `event_time`.

Suggested payload:

```json
{
  "windowFrom": "2026-07-12T10:00:00Z",
  "windowTo": "2026-07-13T10:00:00Z",
  "model": "llama3.1:8b",
  "summaryJson": { "...": "v1 summary contract" }
}
```

Response:

```json
{ "ok": true, "id": 45 }
```

### 3) Read latest summary (for UI/reporting)
`GET /api/agent-smith/summaries/latest`

Behavior:
- Return the latest `agent_smith_events` row where `event_type = "summary"`
- Response includes `summaryJson.summaryText` and timestamp fields needed for chat rendering.

---

## Chat UI Rendering Requirement (MVP)
Render the latest 24h AI summary in the existing chat timeline as if it were a chat message/event.

Expected behavior:
- Summary appears in chronological order with other events.
- Message source label shown as `Agent Smith`.
- Status chip for summary uses `info` style by default.
- Main message line uses `summaryText`.
- Secondary line includes window (`from`/`to`), totals (`events`, `passed`, `failed`, `flaky`, etc.), and model name when available.
- If no summary exists yet, do not show an error card; keep normal event timeline.
- Agent Smith filter defaults to enabled in chat UI.

Suggested integration approach:
- Preferred: fetch one unified timeline from `GET /api/agent-smith/messages` including both `test_result` and `summary` events.
- If needed, use `eventType` filtering for focused views.
- Render `summary` events using the same message component as test events.

---

## Database Design (MVP)
Use existing `agent_smith_events` table for both test events and AI summary events.

Summary event mapping:
- `source`: `agent_smith`
- `event_type`: `summary`
- `status`: `info`
- `message_text`: summary headline (`summaryText`)
- `metadata_json`: full summary contract (`window`, `totals`, `topFailures`, `recommendations`, `confidence`, `model`)
- `event_time`: generation timestamp


---

## Ollama Script Structure (same pattern as previous project)
Implement script patterns aligned with `score-sentences.mjs`:

1. `resolveWritableOutputDir()` with fallback candidates in `/tmp`.
2. Generic `callChatCompletion()` for `v1/chat/completions`.
3. `extractCompletionText()` and strict JSON parsing/validation.
4. Save intermediate artifacts:
   - `agent-smith-events-24h.json`
   - `agent-smith-summary-raw.json`
   - `agent-smith-summary-final.json`
5. Fail fast for invalid JSON from model (clear diagnostics).
6. Keep prompt and parsing logic separated from transport logic.
7. Keep prompt payload compact (aggregates + capped samples) to fit small model context limits.
8. Normalize model output (e.g., recommendations string -> array) before final validation.

### Suggested env vars

```bash
API_URL=http://127.0.0.1:3000
OLLAMA_COMPLETION_URL=http://127.0.0.1:8081/v1/chat/completions
OLLAMA_MODEL=llama3.1:8b
AGENT_SMITH_OUTPUT_DIR=/tmp/agent-smith-summaries
```

---

## Prompt Design (MVP)
System prompt guidance:
- You are a JSON-only API.
- Do not invent missing evidence.
- Base summary only on provided events.
- Output exactly one JSON object matching contract.

User prompt content should include:
- Time window.
- Event list (or condensed aggregates + key failures).
- Required output schema.
- Rule: no markdown/code fences.

---

## Jenkins Automation Pattern (reusing previous setup)
Use the same shell strategy as the scoring Jenkins script:

1. `set -eu` and cleanup trap.
2. Start `llama-server` via `systemctl`.
3. Poll health endpoint (`/health`) until `200`.
4. Set deterministic writable output dir in `/tmp`.
5. Run summary script (`node agent_smith/review-agent-smith-events.mjs`).
6. Run persist step (`node agent_smith/save-agent-smith-summary.mjs`).
7. Stop `llama-server` in trap.

### Reliability rule
- This dedicated summary pipeline is **fail-hard**: if generate or save fails, Jenkins build fails.

---

## Task Breakdown (Implementation Order)
1. **API**: extend messages endpoint with optional `hours` + `eventType` filters.
2. **API**: add `POST /api/agent-smith/summaries` that inserts into `agent_smith_events` with `eventType = summary`.
3. **API**: add `GET /api/agent-smith/summaries/latest` reading latest `summary` event.
4. **Script**: implement `review-agent-smith-events.mjs` using prior pattern.
5. **Jenkins**: add dedicated `agent_smith/Jenkinsfile` job using existing llama startup/readiness flow.
6. **UI**: render `summary` events in chat timeline like other messages.

---

## Definition of Done (for this task)
- Jenkins can run the summary workflow against Ollama.
- Script fetches last 24h events and produces valid summary JSON using test-ID-based outcome classification.
- Summary is persisted in `agent_smith_events` with `event_type = summary` and can be retrieved via latest-summary endpoint.
- Chat page displays the latest AI summary in the same timeline style as chat events.
- Summary job fails when generation or save fails.
- Manual smoke test confirms end-to-end flow.

---

## Example Manual Smoke Test
### 1) Generate summary locally

```bash
cd agent_smith
API_URL=http://127.0.0.1:3000 \
OLLAMA_COMPLETION_URL=http://127.0.0.1:8081/v1/chat/completions \
OLLAMA_MODEL=llama3.1:8b \
node ../agent_smith/review-agent-smith-events.mjs
```

### 2) Persist summary

```bash
node ../agent_smith/save-agent-smith-summary.mjs
```

### 3) Verify latest summary

```bash
curl "http://127.0.0.1:3000/api/agent-smith/summaries/latest"
```

### 4) Verify unified timeline includes AI summary events

```bash
curl "http://127.0.0.1:3000/api/agent-smith/messages?limit=100&eventType=summary"
```

---

## Notes for Phase 2 Compatibility
- Preserve raw event references in `metadata_json` for auditability.
- Keep model adapter generic so Ollama model can be swapped without API changes.
- Avoid coupling summary output directly to UI formatting.
- Keep deterministic classification logic independent from AI narrative generation.
