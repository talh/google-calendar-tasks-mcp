import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { google } from "googleapis";
import { loadConfig } from "./config.js";
import { loadCredentials, createGoogleClient } from "./auth.js";
import { loadGuardrails } from "./guardrails.js";
import { createAuditLogger } from "./audit.js";
import { errorResult } from "./types.js";
import * as cal from "./calendar.js";
import * as tasks from "./tasks.js";
import * as gmail from "./gmail.js";
import type { CalendarApi } from "./calendar.js";
import type { TasksApi } from "./tasks.js";
import type { GmailApi } from "./gmail.js";
import type { GuardrailContext } from "./guardrails.js";

const config = loadConfig();

const server = new McpServer({
  name: "google-calendar-tasks-mcp",
  version: "1.0.0",
});

// Load dependencies
let calendarApi: CalendarApi | null = null;
let tasksApi: TasksApi | null = null;
let gmailApi: GmailApi | null = null;

if (config.testMode) {
  const { createMockCalendarClient, createMockTasksClient, createMockGmailClient } = await import("./test-mocks.js");
  calendarApi = createMockCalendarClient();
  tasksApi = createMockTasksClient();
  gmailApi = createMockGmailClient();
  console.error("[mcp] Running in TEST MODE with mock Google APIs");
} else {
  const creds = await loadCredentials(config.credentialsPath);
  if (creds) {
    const authClient = createGoogleClient(creds, config.credentialsPath);
    calendarApi = google.calendar({ version: "v3", auth: authClient });
    tasksApi = google.tasks({ version: "v1", auth: authClient });
    gmailApi = google.gmail({ version: "v1", auth: authClient });
  }
}

let guardrails: GuardrailContext;
try {
  guardrails = loadGuardrails(config.guardrailsPath);
} catch (err) {
  console.error("[mcp] Failed to load guardrails config, using defaults:", err);
  const { GuardrailContext: GC } = await import("./guardrails.js");
  guardrails = new GC({
    dailyWriteLimit: 50,
    pastEventProtectionDays: 7,
    protectedCalendars: [],
    protectedTaskLists: [],
    allowRecurringSeriesDelete: false,
  });
}

const audit = createAuditLogger(config.auditLogDir);

if (!calendarApi || !tasksApi || !gmailApi) {
  console.error(
    "[mcp] No credentials found. All tools will return AUTH_MISSING. Run 'node auth.js' to set up.",
  );
}

// --- Helper: auth gate for all tools ---
function requireAuth() {
  if (!calendarApi || !tasksApi || !gmailApi) {
    return errorResult({
      error: true,
      code: "AUTH_MISSING",
      message:
        "MCP server not authenticated. Run 'node auth.js' to set up credentials.",
    });
  }
  return null;
}

// ============================================================
// Calendar Tools
// ============================================================

server.tool(
  "calendar_list_calendars",
  "List all calendars the user has access to",
  {},
  async () => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return cal.listCalendars(calendarApi!);
  },
);

server.tool(
  "calendar_list_events",
  "List calendar events for a date or date range",
  {
    calendarId: z.string().optional().default("primary").describe("Calendar ID. Defaults to primary"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Single date in YYYY-MM-DD format"),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Range start in YYYY-MM-DD"),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Range end in YYYY-MM-DD"),
    maxResults: z.number().int().min(1).max(250).optional().default(50).describe("Max events to return"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return cal.listEvents(params, calendarApi!, config);
  },
);

server.tool(
  "calendar_get_event",
  "Get full details of a single calendar event",
  {
    calendarId: z.string().optional().default("primary").describe("Calendar ID. Defaults to primary"),
    eventId: z.string().describe("Google event ID"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return cal.getEvent(params, calendarApi!, config);
  },
);

server.tool(
  "calendar_create_event",
  "Create a new calendar event",
  {
    calendarId: z.string().optional().default("primary").describe("Calendar ID. Defaults to primary"),
    title: z.string().describe("Event title"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date in YYYY-MM-DD"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).describe("Start time in HH:MM (24h)"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).describe("End time in HH:MM (24h)"),
    location: z.string().optional().describe("Event location"),
    description: z.string().optional().describe("Event description"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return cal.createEvent(params, calendarApi!, config, guardrails, audit);
  },
);

server.tool(
  "calendar_update_event",
  "Update an existing calendar event",
  {
    calendarId: z.string().optional().default("primary").describe("Calendar ID. Defaults to primary"),
    eventId: z.string().describe("Google event ID"),
    title: z.string().optional().describe("New title"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("New date in YYYY-MM-DD"),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("New start time in HH:MM"),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("New end time in HH:MM"),
    location: z.string().optional().describe("New location"),
    description: z.string().optional().describe("New description"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return cal.updateEvent(params, calendarApi!, config, guardrails, audit);
  },
);

server.tool(
  "calendar_delete_event",
  "Delete a single calendar event",
  {
    calendarId: z.string().optional().default("primary").describe("Calendar ID. Defaults to primary"),
    eventId: z.string().describe("Google event ID"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return cal.deleteEvent(params, calendarApi!, guardrails, audit);
  },
);

// ============================================================
// Task Tools
// ============================================================

server.tool(
  "tasks_list_tasklists",
  "List all task lists",
  {},
  async () => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return tasks.listTaskLists(tasksApi!);
  },
);

server.tool(
  "tasks_list",
  "List tasks in a given list",
  {
    taskListId: z.string().optional().describe("Task list ID. Defaults to the default list"),
    showCompleted: z.boolean().optional().default(false).describe("Include completed tasks"),
    maxResults: z.number().int().min(1).max(100).optional().default(100).describe("Max tasks to return"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return tasks.listTasks(params, tasksApi!);
  },
);

server.tool(
  "tasks_get",
  "Get full details of a single task",
  {
    taskListId: z.string().describe("Task list ID"),
    taskId: z.string().describe("Google task ID"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return tasks.getTask(params, tasksApi!);
  },
);

server.tool(
  "tasks_create",
  "Create a new task",
  {
    taskListId: z.string().optional().describe("Task list ID. Defaults to the default list"),
    title: z.string().describe("Task title"),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Due date in YYYY-MM-DD"),
    notes: z.string().optional().describe("Task notes/description"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return tasks.createTask(params, tasksApi!, guardrails, audit);
  },
);

server.tool(
  "tasks_update",
  "Update an existing task",
  {
    taskListId: z.string().describe("Task list ID"),
    taskId: z.string().describe("Google task ID"),
    title: z.string().optional().describe("New title"),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("New due date in YYYY-MM-DD"),
    notes: z.string().optional().describe("New notes"),
    status: z.enum(["needsAction", "completed"]).optional().describe("Task status"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return tasks.updateTask(params, tasksApi!, guardrails, audit);
  },
);

server.tool(
  "tasks_delete",
  "Delete a single task",
  {
    taskListId: z.string().describe("Task list ID"),
    taskId: z.string().describe("Google task ID"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return tasks.deleteTask(params, tasksApi!, guardrails, audit);
  },
);

server.tool(
  "tasks_complete",
  "Mark a task as completed",
  {
    taskListId: z.string().describe("Task list ID"),
    taskId: z.string().describe("Google task ID"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return tasks.completeTask(params, tasksApi!, guardrails, audit);
  },
);

server.tool(
  "tasks_move",
  "Move a task to a different list",
  {
    sourceListId: z.string().describe("Source task list ID"),
    taskId: z.string().describe("Google task ID"),
    destinationListId: z.string().describe("Destination task list ID"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return tasks.moveTask(params, tasksApi!, guardrails, audit);
  },
);

// ============================================================
// Gmail Tools
// ============================================================

server.tool(
  "gmail_list_messages",
  "Search and list email messages",
  {
    query: z.string().optional()
      .describe("Gmail search query (same syntax as Gmail search bar). Examples: 'is:unread', 'from:sender@email.com', 'after:2026/02/19'"),
    labelIds: z.array(z.string()).optional()
      .describe("Filter by label IDs (e.g., ['INBOX', 'UNREAD'])"),
    maxResults: z.number().int().min(1).max(100).optional().default(20)
      .describe("Max messages to return"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return gmail.listMessages(params, gmailApi!);
  },
);

server.tool(
  "gmail_get_message",
  "Get the full content of a single email",
  {
    messageId: z.string().describe("Gmail message ID"),
    format: z.enum(["full", "metadata", "minimal"]).optional().default("full")
      .describe("Response format. 'full' includes body text, 'metadata' includes headers only"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return gmail.getMessage(params, gmailApi!);
  },
);

server.tool(
  "gmail_get_attachment",
  "Download a specific attachment from an email",
  {
    messageId: z.string().describe("Gmail message ID"),
    attachmentId: z.string().describe("Attachment ID from gmail_get_message response"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return gmail.getAttachment(params, gmailApi!, guardrails);
  },
);

server.tool(
  "gmail_modify_message",
  "Add or remove labels from an email. Remove 'INBOX' to archive. Add 'TRASH' to trash.",
  {
    messageId: z.string().describe("Gmail message ID"),
    addLabelIds: z.array(z.string()).optional()
      .describe("Label IDs to add"),
    removeLabelIds: z.array(z.string()).optional()
      .describe("Label IDs to remove. Remove 'INBOX' to archive. Add 'TRASH' to trash."),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return gmail.modifyMessage(params, gmailApi!, guardrails, audit);
  },
);

server.tool(
  "gmail_list_labels",
  "List all Gmail labels (system and user-created)",
  {},
  async () => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return gmail.listLabels(gmailApi!);
  },
);

server.tool(
  "gmail_create_label",
  "Create a new Gmail label. Use '/' for nesting (e.g., 'DPA/Expense')",
  {
    name: z.string()
      .describe("Label name. Use '/' for nesting (e.g., 'DPA/Expense')"),
    labelListVisibility: z.enum(["labelShow", "labelShowIfUnread", "labelHide"])
      .optional().default("labelShow")
      .describe("Visibility in Gmail label list"),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return gmail.createLabel(params, gmailApi!, guardrails, audit);
  },
);

server.tool(
  "gmail_send_message",
  "Send an email (reply or new). Requires explicit approval — requireApproval must be true.",
  {
    to: z.string().describe("Recipient email address"),
    subject: z.string().describe("Email subject"),
    body: z.string().describe("Email body (plain text)"),
    inReplyTo: z.string().optional()
      .describe("Message-ID header of the email being replied to (for threading)"),
    threadId: z.string().optional()
      .describe("Gmail thread ID to place reply in the correct thread"),
    requireApproval: z.literal(true)
      .describe("Must be true. Confirms the user explicitly approved sending this email."),
  },
  async (params) => {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return gmail.sendMessage(params, gmailApi!, guardrails, audit);
  },
);

// ============================================================
// Start server
// ============================================================

const transport = new StdioServerTransport();
await server.connect(transport);
