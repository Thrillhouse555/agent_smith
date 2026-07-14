# Phase 1 — Task 1 Setup
## Chat Interface + Chat-Style Test Result Ingestion (MVP)

## Objective
Deliver the **first working slice** of Agent Smith:

1. A simple chat-style UI that shows test activity in time order.
2. A webhook endpoint that receives test results in a **Chat-like incoming webhook pattern**.
3. Persisted events so test history can be viewed and queried later.

This is a foundation task, not full intelligence yet. Focus on reliable ingestion + clear visibility.

---

## Scope (MVP)
### In scope
- Web chat timeline page for Agent Smith events.
- API endpoint to receive test events (`POST` webhook).
- Basic message persistence in DB.
- Status categories: `passed`, `failed`, `warning`, `info`.
- Simple polling from UI to API for latest messages.

### Out of scope (for this task)
- AI failure analysis.
- Flaky test detection logic.
- Auto-reruns.
- Defect creation.
- Complex auth/roles for chat users.

---

## Recommended Architecture (using current repo)
- **Frontend:** `website/` (new page, plain HTML/CSS/JS).
- **Backend:** `my-api/index.js` (new webhook + read endpoint).
- **Storage:** MySQL table for chat events.
- **Test frameworks posting events:** Cypress / Playwright / Serenity scripts via HTTP `POST`.

Flow:

```text
Test Runner -> POST /api/agent-smith/webhook -> DB (chat_events) -> GET /api/agent-smith/messages -> Chat UI
```

---

## Chat-Style Ingestion Model
Use an incoming webhook model similar to a Chat message:

- Sender posts JSON to a single endpoint.
- Sender includes lightweight metadata (source, status, text, run id, links).
- Receiver validates shared secret and records a normalized message.

### Endpoint
`POST /api/agent-smith/webhook`

### Security (MVP)
- Header: `x-agent-smith-secret: <WEBHOOK_SECRET>`
- Secret from environment variable in API process.
- Reject missing/invalid secret with `403`.

---

## Payload Contract (v1)
Use a simple, stable payload shape:

```json
{
  "source": "cypress",
  "eventType": "test_result",
  "status": "failed",
  "runId": "cypress-2026-07-09-001",
  "suite": "Login Suite",
  "testName": "should login with valid credentials",
  "text": "Element #submit-login not found within 10000ms",
  "timestamp": "2026-07-09T18:40:00Z",
  "meta": {
    "spec": "cypress/e2e/test_suites/login.cy.js",
    "durationMs": 10023,
    "buildUrl": "https://ci.example/run/123"
  }
}
```

### Required fields
- `source` (`cypress` | `playwright` | `serenity` | `manual`)
- `eventType` (`test_result` for now)
- `status` (`passed` | `failed` | `warning` | `info`)
- `text` (human-readable summary)
- `timestamp` (ISO8601)

### Optional fields
- `runId`, `suite`, `testName`, `meta`.

---

## Database Design (MVP)
Create one table for now:

```sql
CREATE TABLE IF NOT EXISTS agent_smith_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  run_id VARCHAR(120) NULL,
  suite VARCHAR(255) NULL,
  test_name VARCHAR(255) NULL,
  message_text TEXT NOT NULL,
  metadata_json JSON NULL,
  event_time DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_event_time (event_time),
  INDEX idx_run_id (run_id),
  INDEX idx_status (status)
);
```

---

## API Endpoints to Add
### 1) Ingest webhook
`POST /api/agent-smith/webhook`

Behavior:
- Validate secret header.
- Validate required fields + allowed status values.
- Insert row into `agent_smith_events`.
- Return `202 Accepted` with `{ "ok": true, "id": <eventId> }`.

### 2) Read latest messages for chat
`GET /api/agent-smith/messages?limit=50&runId=<optional>`

Behavior:
- Return newest-first (or oldest-first if preferred by UI).
- Include fields needed for chat rendering.

Suggested response:

```json
{
  "items": [
    {
      "id": 120,
      "source": "cypress",
      "status": "failed",
      "text": "Element #submit-login not found within 10000ms",
      "suite": "Login Suite",
      "testName": "should login with valid credentials",
      "runId": "cypress-2026-07-09-001",
      "timestamp": "2026-07-09T18:40:00Z"
    }
  ]
}
```

---

## Frontend Chat Page (MVP)
Create a page, for example:
- `website/agent-chat.html`

UI sections:
1. Header (Agent Smith + connection status).
2. Scrollable message timeline.
3. Simple filter row (optional in MVP: runId text filter only).
4. Auto-refresh every 5 seconds.

Message card format:
- Badge: source (`Cypress`, `Playwright`, `Serenity`)
- Status chip color by status.
- Main text line.
- Secondary line: suite / test / time / runId.

Keep it lightweight and readable.

---

## Integration Pattern for Test Frameworks
### Cypress / Playwright / Serenity scripts
At the end of each test (or on fail hook):
1. Build event object in v1 payload format.
2. `POST` to `/api/agent-smith/webhook`.
3. Do not fail whole test run if webhook call fails (log warning only for now).

This mirrors Chat-style reliability expectations: notification side-channel should not block primary execution.

---

## Environment Variables
Add to API `.env`:

```bash
WEBHOOK_SECRET=<strong-random-secret>
AGENT_SMITH_CHAT_RETENTION_DAYS=30
```

---

## Task Breakdown (Implementation Order)
1. **DB migration**: create `agent_smith_events`.
2. **Backend**: add webhook ingest endpoint.
3. **Backend**: add messages read endpoint.
4. **Frontend**: create chat page + polling renderer.
5. **Framework hook**: wire one framework first (Serenity).
6. **Smoke test**: send mock payload via `curl`, verify appears in chat.

---

## Definition of Done (for this task)
- Can send test result payload with a secret and receive `202`.
- Event appears in DB with correct status and metadata.
- Chat page displays ingested event within polling interval.
- At least one real framework run posts events automatically.
- Basic error handling present (invalid payload, unauthorized secret).

---

## Implementation Status (Updated)
### Completed
- ✅ API routes implemented in `my-api/index.js`:
  - `POST /api/agent-smith/webhook`
  - `GET /api/agent-smith/messages`
- ✅ `agent_smith_events` table bootstrap/creation added at API startup.
- ✅ Chat page implemented at `website/agent-chat.html` with polling and runId filter.
- ✅ Reporting navigation updated to include link to the chat page.
- ✅ Serenity publisher implemented at `agent_smith/send-agent-smith-events.mjs`.
- ✅ Jenkins post-run publish hook added in `selenium_cucumber_serenity/Jenkinsfile`.
- ✅ Jenkins credential handling added:
  - supports env var `AGENT_SMITH_WEBHOOK_SECRET`
  - supports Jenkins Secret Text credential (default id: `agent-smith-webhook-secret`)
  - supports optional credential id override via `AGENT_SMITH_WEBHOOK_SECRET_CREDENTIAL_ID`

### Adjustments Made During Delivery (Plan Changes)
- Changed Serenity sender location from `selenium_cucumber_serenity/scripts/` to `agent_smith/` to keep Agent Smith-specific logic together.
- Updated Jenkins script execution path to `node ../agent_smith/send-agent-smith-events.mjs`.
- Added credential probe logging in Jenkins to troubleshoot credential scope/type issues safely.
- Kept webhook publishing non-critical to core test execution goals (logs warnings on missing config or sender preconditions).
- Updated chat source label behavior to display `serenity` events as **Selenium** in UI.

### Remaining Validation / Operational Steps
- Ensure API runtime has `WEBHOOK_SECRET` configured and API process restarted.
- Ensure Jenkins credential is present as **Secret text** and accessible to the pipeline job.
- Run one full Serenity pipeline and confirm events appear in chat with expected `runId`.

---

## Example Manual Test
```bash
curl -X POST http://localhost:3000/api/agent-smith/webhook \
  -H "Content-Type: application/json" \
  -H "x-agent-smith-secret: $WEBHOOK_SECRET" \
  -d '{
    "source":"cypress",
    "eventType":"test_result",
    "status":"failed",
    "runId":"local-smoke-001",
    "suite":"Login Suite",
    "testName":"should login",
    "text":"Timeout waiting for #auth-form",
    "timestamp":"2026-07-09T19:00:00Z"
  }'
```

Then open the new chat page and confirm the message is rendered.

---

## Notes for Phase 2 Compatibility
To keep Phase 2 simple later:
- Preserve raw `metadata_json` for richer AI prompts.
- Keep message schema stable (`source`, `status`, `text`, `timestamp`).
- Add future fields instead of renaming existing fields.

This gives a clean handoff from "event logging" to "AI investigation" without reworking ingestion.
