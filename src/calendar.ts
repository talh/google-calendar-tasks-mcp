import type { calendar_v3 } from "googleapis";
import type { ServerConfig } from "./config.js";
import type { GuardrailContext } from "./guardrails.js";
import type { AuditLogger } from "./audit.js";
import { successResult, errorResult, type ToolResult } from "./types.js";
import { GuardrailError, apiError } from "./errors.js";

// ============================================================
// Types
// ============================================================

/** The subset of google.calendar("v3") we actually use */
export interface CalendarApi {
  calendarList: { list: (params?: any) => Promise<{ data: any }> };
  events: {
    list: (params: any) => Promise<{ data: any }>;
    get: (params: any) => Promise<{ data: any }>;
    insert: (params: any) => Promise<{ data: any }>;
    patch: (params: any) => Promise<{ data: any }>;
    delete: (params: any) => Promise<any>;
  };
}

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

function getUtcOffset(date: string, timezone: string): string {
  const dt = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  }).formatToParts(dt);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // tzPart is like "GMT+2" or "GMT-5:30" or "GMT"
  const match = tzPart.match(/GMT([+-]\d{1,2}(?::?\d{2})?)?$/);
  if (!match || !match[1]) return "+00:00";
  const raw = match[1];
  // Normalize to ±HH:MM
  const [h, m] = raw.includes(":") ? raw.split(":") : [raw, "00"];
  const sign = h![0] === "-" ? "-" : "+";
  const hours = Math.abs(parseInt(h!, 10)).toString().padStart(2, "0");
  const minutes = (m ?? "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function dayBounds(date: string, timezone: string) {
  const offset = getUtcOffset(date, timezone);
  return {
    timeMin: `${date}T00:00:00${offset}`,
    timeMax: `${date}T23:59:59${offset}`,
  };
}

// ============================================================
// Handlers
// ============================================================

export async function listCalendars(
  api: CalendarApi,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const { data } = await api.calendarList.list();

    const calendars = (data.items ?? []).map((c: any) => ({
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
  api: CalendarApi,
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

    let timeMin: string;
    let timeMax: string;

    if (params.date) {
      const bounds = dayBounds(params.date, config.timezone);
      timeMin = bounds.timeMin;
      timeMax = bounds.timeMax;
    } else {
      const startOffset = getUtcOffset(params.startDate!, config.timezone);
      const endOffset = getUtcOffset(params.endDate!, config.timezone);
      timeMin = `${params.startDate}T00:00:00${startOffset}`;
      timeMax = `${params.endDate}T23:59:59${endOffset}`;
    }

    const { data } = await api.events.list({
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
  api: CalendarApi,
  config: ServerConfig,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const { data } = await api.events.get({
      calendarId: params.calendarId,
      eventId: params.eventId,
      timeZone: config.timezone,
    });
    return successResult(transformEvent(data));
  });
}

export async function createEvent(
  params: CreateEventParams,
  api: CalendarApi,
  config: ServerConfig,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(1);
    guardrails.checkProtectedCalendar(params.calendarId);

    const eventBody = {
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

    const { data } = await api.events.insert({
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
  api: CalendarApi,
  config: ServerConfig,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(1);
    guardrails.checkProtectedCalendar(params.calendarId);

    // Fetch existing event for past-event protection check
    const { data: existing } = await api.events.get({
      calendarId: params.calendarId,
      eventId: params.eventId,
    });

    const endTime = existing.end?.dateTime ?? existing.end?.date;
    if (endTime) {
      guardrails.checkPastEventProtection(endTime);
    }

    // Build patch with only provided fields
    const patch: Record<string, any> = {};
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

    const { data } = await api.events.patch({
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
  api: CalendarApi,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(1);
    guardrails.checkProtectedCalendar(params.calendarId);

    // Fetch existing event for guardrail checks and audit title
    const { data: existing } = await api.events.get({
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

    await api.events.delete({
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
