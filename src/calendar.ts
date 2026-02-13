import { google, type calendar_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { ServerConfig } from "./config.js";
import type { GuardrailContext } from "./guardrails.js";
import type { AuditLogger } from "./audit.js";
import { successResult, errorResult, type ToolResult } from "./types.js";
import { GuardrailError, apiError } from "./errors.js";

// ============================================================
// Types
// ============================================================

export interface ListEventsParams {
  calendarId: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  maxResults: number;
}

export interface GetEventParams {
  calendarId: string;
  eventId: string;
}

export interface CreateEventParams {
  calendarId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location?: string;
  description?: string;
}

export interface UpdateEventParams {
  calendarId: string;
  eventId: string;
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  description?: string;
}

export interface DeleteEventParams {
  calendarId: string;
  eventId: string;
}

// ============================================================
// Response transformation
// ============================================================

function extractDate(dateTime: string | null | undefined): string | undefined {
  if (!dateTime) return undefined;
  return dateTime.slice(0, 10);
}

function extractTime(dateTime: string | null | undefined): string | undefined {
  if (!dateTime) return undefined;
  // dateTime is like "2026-02-13T10:00:00+02:00" or "2026-02-13T10:00:00Z"
  const match = dateTime.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : undefined;
}

export function transformEvent(event: calendar_v3.Schema$Event) {
  const isAllDay = !!event.start?.date;
  return {
    id: event.id,
    title: event.summary ?? "(no title)",
    startTime: isAllDay ? undefined : extractTime(event.start?.dateTime),
    endTime: isAllDay ? undefined : extractTime(event.end?.dateTime),
    date: isAllDay
      ? event.start?.date
      : extractDate(event.start?.dateTime),
    location: event.location ?? undefined,
    description: event.description ?? undefined,
    isAllDay,
    isRecurring: !!event.recurringEventId,
    attendees: event.attendees?.map((a) => ({
      email: a.email,
      name: a.displayName,
      status: a.responseStatus,
    })),
  };
}

// ============================================================
// Error handling wrapper
// ============================================================

function isGaxiosError(err: unknown): err is { response?: { status?: number }; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    ("response" in err || "code" in err)
  );
}

async function withErrorHandling(
  handler: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof GuardrailError) {
      return errorResult(err.toStructured());
    }
    if (isGaxiosError(err)) {
      return errorResult(apiError(err.response?.status ?? 500, err.message));
    }
    console.error("[mcp] Unexpected error:", err);
    return errorResult({
      error: true,
      code: "API_ERROR",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

// ============================================================
// Date helpers
// ============================================================

/**
 * Given a YYYY-MM-DD date and a timezone, return the start-of-day and
 * end-of-day as ISO strings suitable for Google Calendar API timeMin/timeMax.
 */
function dayBounds(date: string, timezone: string) {
  // Build an Intl formatter for the target timezone so we compute the
  // correct UTC offset. For the API we pass timeZone directly, so we
  // just need ISO-ish strings with the date.
  return {
    timeMin: `${date}T00:00:00`,
    timeMax: `${date}T23:59:59`,
  };
}

// ============================================================
// Handlers
// ============================================================

export async function listCalendars(
  client: OAuth2Client,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const cal = google.calendar({ version: "v3", auth: client });
    const { data } = await cal.calendarList.list();

    const calendars = (data.items ?? []).map((c) => ({
      id: c.id,
      name: c.summary,
      primary: c.primary ?? false,
      accessRole: c.accessRole,
    }));

    return successResult(calendars);
  });
}

export async function listEvents(
  params: ListEventsParams,
  client: OAuth2Client,
  config: ServerConfig,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    if (!params.date && !(params.startDate && params.endDate)) {
      return errorResult({
        error: true,
        code: "VALIDATION_ERROR",
        message: "Provide either 'date' or both 'startDate' and 'endDate'",
      });
    }

    const cal = google.calendar({ version: "v3", auth: client });

    let timeMin: string;
    let timeMax: string;

    if (params.date) {
      const bounds = dayBounds(params.date, config.timezone);
      timeMin = bounds.timeMin;
      timeMax = bounds.timeMax;
    } else {
      timeMin = `${params.startDate}T00:00:00`;
      timeMax = `${params.endDate}T23:59:59`;
    }

    const { data } = await cal.events.list({
      calendarId: params.calendarId,
      timeMin,
      timeMax,
      timeZone: config.timezone,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: params.maxResults,
    });

    const events = (data.items ?? []).map(transformEvent);
    return successResult(events);
  });
}

export async function getEvent(
  params: GetEventParams,
  client: OAuth2Client,
  config: ServerConfig,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const cal = google.calendar({ version: "v3", auth: client });
    const { data } = await cal.events.get({
      calendarId: params.calendarId,
      eventId: params.eventId,
      timeZone: config.timezone,
    });
    return successResult(transformEvent(data));
  });
}

export async function createEvent(
  params: CreateEventParams,
  client: OAuth2Client,
  config: ServerConfig,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(1);
    guardrails.checkProtectedCalendar(params.calendarId);

    const cal = google.calendar({ version: "v3", auth: client });

    const eventBody: calendar_v3.Schema$Event = {
      summary: params.title,
      start: {
        dateTime: `${params.date}T${params.startTime}:00`,
        timeZone: config.timezone,
      },
      end: {
        dateTime: `${params.date}T${params.endTime}:00`,
        timeZone: config.timezone,
      },
      location: params.location,
      description: params.description,
    };

    const { data } = await cal.events.insert({
      calendarId: params.calendarId,
      requestBody: eventBody,
    });

    guardrails.incrementWriteCounter(1);

    try {
      await audit.log({
        operation: "create",
        service: "calendar",
        title: params.title,
        googleId: data.id ?? "",
        timestamp: new Date().toISOString(),
        source: "mcp",
      });
    } catch (err) {
      console.error("[audit] Failed to write audit entry:", err);
    }

    return successResult({
      id: data.id,
      title: data.summary,
      startTime: extractTime(data.start?.dateTime),
      endTime: extractTime(data.end?.dateTime),
    });
  });
}

export async function updateEvent(
  params: UpdateEventParams,
  client: OAuth2Client,
  config: ServerConfig,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(1);
    guardrails.checkProtectedCalendar(params.calendarId);

    const cal = google.calendar({ version: "v3", auth: client });

    // Fetch existing event for past-event protection check
    const { data: existing } = await cal.events.get({
      calendarId: params.calendarId,
      eventId: params.eventId,
    });

    const endTime = existing.end?.dateTime ?? existing.end?.date;
    if (endTime) {
      guardrails.checkPastEventProtection(endTime);
    }

    // Build patch with only provided fields
    const patch: calendar_v3.Schema$Event = {};
    const changes: Record<string, unknown> = {};

    if (params.title !== undefined) {
      patch.summary = params.title;
      changes.title = params.title;
    }

    if (params.date !== undefined || params.startTime !== undefined) {
      const date = params.date ?? extractDate(existing.start?.dateTime) ?? "";
      const time = params.startTime ?? extractTime(existing.start?.dateTime) ?? "00:00";
      patch.start = {
        dateTime: `${date}T${time}:00`,
        timeZone: config.timezone,
      };
      if (params.startTime !== undefined) changes.startTime = params.startTime;
      if (params.date !== undefined) changes.date = params.date;
    }

    if (params.date !== undefined || params.endTime !== undefined) {
      const date = params.date ?? extractDate(existing.end?.dateTime) ?? "";
      const time = params.endTime ?? extractTime(existing.end?.dateTime) ?? "00:00";
      patch.end = {
        dateTime: `${date}T${time}:00`,
        timeZone: config.timezone,
      };
      if (params.endTime !== undefined) changes.endTime = params.endTime;
    }

    if (params.location !== undefined) {
      patch.location = params.location;
      changes.location = params.location;
    }

    if (params.description !== undefined) {
      patch.description = params.description;
      changes.description = params.description;
    }

    const { data } = await cal.events.patch({
      calendarId: params.calendarId,
      eventId: params.eventId,
      requestBody: patch,
    });

    guardrails.incrementWriteCounter(1);

    try {
      await audit.log({
        operation: "update",
        service: "calendar",
        title: data.summary ?? params.title ?? "",
        googleId: data.id ?? params.eventId,
        changes,
        timestamp: new Date().toISOString(),
        source: "mcp",
      });
    } catch (err) {
      console.error("[audit] Failed to write audit entry:", err);
    }

    return successResult({
      id: data.id,
      title: data.summary,
      startTime: extractTime(data.start?.dateTime),
      endTime: extractTime(data.end?.dateTime),
    });
  });
}

export async function deleteEvent(
  params: DeleteEventParams,
  client: OAuth2Client,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(1);
    guardrails.checkProtectedCalendar(params.calendarId);

    const cal = google.calendar({ version: "v3", auth: client });

    // Fetch existing event for guardrail checks and audit title
    const { data: existing } = await cal.events.get({
      calendarId: params.calendarId,
      eventId: params.eventId,
    });

    const endTime = existing.end?.dateTime ?? existing.end?.date;
    if (endTime) {
      guardrails.checkPastEventProtection(endTime);
    }

    guardrails.checkRecurringSeriesDelete({
      recurrence: existing.recurrence ?? undefined,
      recurringEventId: existing.recurringEventId ?? undefined,
    });

    await cal.events.delete({
      calendarId: params.calendarId,
      eventId: params.eventId,
    });

    guardrails.incrementWriteCounter(1);

    try {
      await audit.log({
        operation: "delete",
        service: "calendar",
        title: existing.summary ?? "(no title)",
        googleId: params.eventId,
        timestamp: new Date().toISOString(),
        source: "mcp",
      });
    } catch (err) {
      console.error("[audit] Failed to write audit entry:", err);
    }

    return successResult({
      success: true,
      deletedTitle: existing.summary ?? "(no title)",
    });
  });
}
