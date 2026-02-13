# Manual Testing Checklist

Use this checklist when testing with real Google API credentials or after major changes.

## Prerequisites

- [ ] `node auth.js` completed successfully
- [ ] `npm run build` succeeds with no errors
- [ ] `npm test` passes all unit and integration tests

## MCP Inspector Smoke Tests

Start the inspector: `npm run inspect`

### Calendar — Read Operations

- [ ] `calendar_list_calendars` — returns your calendars with IDs
- [ ] `calendar_list_events` with `date: "YYYY-MM-DD"` (today) — returns today's events
- [ ] `calendar_list_events` with `startDate` + `endDate` — returns events in range
- [ ] `calendar_list_events` without date params — returns `VALIDATION_ERROR`
- [ ] `calendar_get_event` with a valid `eventId` — returns full event details

### Calendar — Write Operations

- [ ] `calendar_create_event` — creates event, verify in Google Calendar
- [ ] `calendar_update_event` — updates title/time, verify in Google Calendar
- [ ] `calendar_delete_event` — deletes event, verify removed from Google Calendar
- [ ] Create + delete to confirm write counter increments

### Calendar — Guardrails

- [ ] Try updating an event older than `pastEventProtectionDays` — returns `PAST_EVENT_PROTECTED`
- [ ] Try deleting a recurring series master (not an instance) — returns `RECURRING_SERIES_DELETE`
- [ ] Add a calendar ID to `protectedCalendars` in guardrails.json, try creating — returns `PROTECTED_RESOURCE`

### Tasks — Read Operations

- [ ] `tasks_list_tasklists` — returns your task lists
- [ ] `tasks_list` — returns tasks from default list
- [ ] `tasks_list` with `showCompleted: true` — includes completed tasks
- [ ] `tasks_get` with a valid `taskId` — returns task details

### Tasks — Write Operations

- [ ] `tasks_create` — creates task, verify in Google Tasks
- [ ] `tasks_create` with `due` and `notes` — all fields populated
- [ ] `tasks_update` — updates title, verify in Google Tasks
- [ ] `tasks_complete` — marks as completed, verify status
- [ ] `tasks_delete` — deletes task, verify removed
- [ ] `tasks_move` — moves task between lists, verify in both lists

### Tasks — Guardrails

- [ ] Add a task list ID to `protectedTaskLists`, try creating — returns `PROTECTED_RESOURCE`
- [ ] Set `dailyWriteLimit: 2`, perform 3 writes — third returns `DAILY_LIMIT_REACHED`

### Audit Logging

- [ ] Set `GOOGLE_MCP_AUDIT_LOG_DIR`, perform write operations
- [ ] Verify `operations_YYYY-MM.json` file created with correct entries
- [ ] Verify entries contain: operation, service, title, googleId, timestamp

### Error Handling

- [ ] Remove credentials file, start server — tools return `AUTH_MISSING`
- [ ] Pass invalid `eventId` to `calendar_get_event` — returns `NOT_FOUND`
- [ ] Pass invalid `taskId` to `tasks_get` — returns `NOT_FOUND`

### Test Mode

- [ ] Start with `GOOGLE_MCP_TEST_MODE=true` — server logs test mode message
- [ ] All tools return mock data without real API calls
- [ ] Write operations succeed and audit logging works

## Claude Code Integration

- [ ] Configure MCP server in `.mcp.json`
- [ ] Ask Claude to list your calendars — tool is called correctly
- [ ] Ask Claude to show today's events — returns real calendar data
- [ ] Ask Claude to create an event — event appears in Google Calendar
- [ ] Ask Claude to list your tasks — returns real task data
