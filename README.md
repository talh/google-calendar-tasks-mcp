# google-calendar-tasks-mcp

MCP server for Google Calendar and Google Tasks with safety guardrails.

Built for use with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and any MCP-compatible client.

## Features

- **14 tools**: full CRUD for calendar events and tasks
- **Safety guardrails**: daily write limits, protected calendars/task lists, past-event protection, recurring series protection
- **Optional audit logging**: monthly JSON files tracking all write operations
- **Cross-platform**: Windows, macOS, Linux
- **Configurable** via environment variables and `guardrails.json`
- **Test mode** for development without Google API credentials

## Prerequisites

- Node.js 18+
- A Google Cloud project with Calendar and Tasks APIs enabled
- An OAuth 2.0 client ID (type: Desktop)

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/talh/google-calendar-tasks-mcp.git
cd google-calendar-tasks-mcp
npm install

# 2. Build
npm run build

# 3. Authenticate (one-time)
node auth.js

# 4. Test with MCP Inspector
npm run inspect
```

## Google Cloud Project Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Enable the **Google Calendar API**:
   - Navigate to APIs & Services > Library
   - Search for "Google Calendar API" and enable it
4. Enable the **Google Tasks API**:
   - Search for "Google Tasks API" and enable it
5. Configure the **OAuth consent screen**:
   - Navigate to APIs & Services > OAuth consent screen
   - Choose "External" user type
   - Fill in the required fields (app name, support email)
   - Add scopes: `calendar.events` and `tasks`
   - Add yourself as a test user
6. Create **OAuth 2.0 credentials**:
   - Navigate to APIs & Services > Credentials
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Desktop app" as the application type
   - Note the Client ID and Client Secret

## Authentication

Run the auth script to set up OAuth credentials:

```bash
node auth.js
```

The script will:
1. Prompt for your Client ID and Client Secret
2. Open your browser to the Google consent screen
3. Listen for the OAuth callback on `http://localhost:3000/callback`
4. Save credentials to the OS-specific default path

**Credential storage locations:**
- Windows: `%APPDATA%\google-calendar-tasks-mcp\credentials.json`
- macOS/Linux: `~/.config/google-calendar-tasks-mcp/credentials.json`

Override with `GOOGLE_MCP_CREDENTIALS_PATH` environment variable.

## Claude Code Configuration

Add to your Claude Code MCP settings (project-level `.mcp.json` or global settings):

```json
{
  "mcpServers": {
    "google-calendar-tasks": {
      "command": "node",
      "args": ["/absolute/path/to/google-calendar-tasks-mcp/build/index.js"],
      "env": {
        "GOOGLE_MCP_TIMEZONE": "America/New_York"
      }
    }
  }
}
```

## Tool Reference

### Calendar Tools

#### `calendar_list_calendars`

List all calendars the user has access to.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | | | |

#### `calendar_list_events`

List calendar events for a date or date range.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendarId` | string | No | Calendar ID. Defaults to `"primary"` |
| `date` | string | No | Single date in `YYYY-MM-DD` format |
| `startDate` | string | No | Range start in `YYYY-MM-DD` |
| `endDate` | string | No | Range end in `YYYY-MM-DD` |
| `maxResults` | number | No | Max events to return (1-250, default 50) |

Provide either `date` or both `startDate` and `endDate`.

#### `calendar_get_event`

Get full details of a single calendar event.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendarId` | string | No | Calendar ID. Defaults to `"primary"` |
| `eventId` | string | Yes | Google event ID |

#### `calendar_create_event`

Create a new calendar event. Subject to guardrails.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendarId` | string | No | Calendar ID. Defaults to `"primary"` |
| `title` | string | Yes | Event title |
| `date` | string | Yes | Date in `YYYY-MM-DD` |
| `startTime` | string | Yes | Start time in `HH:MM` (24h) |
| `endTime` | string | Yes | End time in `HH:MM` (24h) |
| `location` | string | No | Event location |
| `description` | string | No | Event description |

#### `calendar_update_event`

Update an existing calendar event. Subject to guardrails.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendarId` | string | No | Calendar ID. Defaults to `"primary"` |
| `eventId` | string | Yes | Google event ID |
| `title` | string | No | New title |
| `date` | string | No | New date in `YYYY-MM-DD` |
| `startTime` | string | No | New start time in `HH:MM` |
| `endTime` | string | No | New end time in `HH:MM` |
| `location` | string | No | New location |
| `description` | string | No | New description |

Blocked for events older than `pastEventProtectionDays`.

#### `calendar_delete_event`

Delete a single calendar event. Subject to guardrails.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `calendarId` | string | No | Calendar ID. Defaults to `"primary"` |
| `eventId` | string | Yes | Google event ID |

Blocked for past events and recurring series masters (unless `allowRecurringSeriesDelete` is true).

### Task Tools

#### `tasks_list_tasklists`

List all task lists.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | | | |

#### `tasks_list`

List tasks in a given list.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskListId` | string | No | Task list ID. Defaults to the default list |
| `showCompleted` | boolean | No | Include completed tasks (default false) |
| `maxResults` | number | No | Max tasks to return (1-100, default 100) |

#### `tasks_get`

Get full details of a single task.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskListId` | string | Yes | Task list ID |
| `taskId` | string | Yes | Google task ID |

#### `tasks_create`

Create a new task. Subject to guardrails.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskListId` | string | No | Task list ID. Defaults to the default list |
| `title` | string | Yes | Task title |
| `due` | string | No | Due date in `YYYY-MM-DD` |
| `notes` | string | No | Task notes/description |

#### `tasks_update`

Update an existing task. Subject to guardrails.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskListId` | string | Yes | Task list ID |
| `taskId` | string | Yes | Google task ID |
| `title` | string | No | New title |
| `due` | string | No | New due date in `YYYY-MM-DD` |
| `notes` | string | No | New notes |
| `status` | string | No | `"needsAction"` or `"completed"` |

#### `tasks_delete`

Delete a single task. Subject to guardrails.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskListId` | string | Yes | Task list ID |
| `taskId` | string | Yes | Google task ID |

#### `tasks_complete`

Mark a task as completed. Subject to guardrails.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskListId` | string | Yes | Task list ID |
| `taskId` | string | Yes | Google task ID |

#### `tasks_move`

Move a task to a different list. Counts as 2 write operations (create + delete). Subject to guardrails.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceListId` | string | Yes | Source task list ID |
| `taskId` | string | Yes | Google task ID |
| `destinationListId` | string | Yes | Destination task list ID |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GOOGLE_MCP_TIMEZONE` | System timezone | IANA timezone (e.g., `America/New_York`) |
| `GOOGLE_MCP_CREDENTIALS_PATH` | OS-specific path | Path to OAuth credentials file |
| `GOOGLE_MCP_AUDIT_LOG_DIR` | *(disabled)* | Directory for audit log files |
| `GOOGLE_MCP_GUARDRAILS_PATH` | `./guardrails.json` | Path to guardrails config |
| `GOOGLE_MCP_TEST_MODE` | `false` | Run with mock Google APIs |

### Guardrails Configuration

Create or edit `guardrails.json` in the server directory:

```json
{
  "dailyWriteLimit": 50,
  "pastEventProtectionDays": 7,
  "protectedCalendars": [],
  "protectedTaskLists": [],
  "allowRecurringSeriesDelete": false
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `dailyWriteLimit` | 50 | Max write operations per UTC day |
| `pastEventProtectionDays` | 7 | Block edits/deletes on events older than N days |
| `protectedCalendars` | `[]` | Calendar IDs that cannot be written to |
| `protectedTaskLists` | `[]` | Task list IDs that cannot be written to |
| `allowRecurringSeriesDelete` | `false` | Allow deleting an entire recurring event series |

### Audit Logging

Enable by setting `GOOGLE_MCP_AUDIT_LOG_DIR` to a directory path. The server writes monthly JSON files (`operations_YYYY-MM.json`) tracking all create, update, delete, complete, and move operations.

Each entry includes: operation type, service, item title, Google ID, timestamp, and any changes made.

## Development

```bash
npm run build          # Compile TypeScript
npm test               # Run all tests
npm run test:unit      # Run unit tests only
npm run test:integration  # Run integration tests only
npm run inspect        # Launch MCP Inspector
```

### Test Mode

Set `GOOGLE_MCP_TEST_MODE=true` to run with mock Google APIs. Useful for development and testing without real credentials.

## License

MIT
