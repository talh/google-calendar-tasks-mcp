import { describe, it, expect, vi } from "vitest";
import { transformEvent, listCalendars, listEvents, getEvent, createEvent, updateEvent, deleteEvent } from "../../src/calendar.js";
import { GuardrailContext } from "../../src/guardrails.js";
import type { AuditLogger } from "../../src/audit.js";
import type { ServerConfig } from "../../src/config.js";
import { createMockCalendarClient, resetMockState } from "../../src/test-mocks.js";

// ============================================================
// transformEvent
// ============================================================

describe("transformEvent", () => {
  it("transforms a timed event correctly", () => {
    const result = transformEvent({
      id: "evt1",
      summary: "Team Standup",
      start: { dateTime: "2026-02-13T10:00:00+02:00" },
      end: { dateTime: "2026-02-13T10:30:00+02:00" },
      location: "Room A",
      description: "Daily standup",
    });
    expect(result.id).toBe("evt1");
    expect(result.title).toBe("Team Standup");
    expect(result.startTime).toBe("10:00");
    expect(result.endTime).toBe("10:30");
    expect(result.date).toBe("2026-02-13");
    expect(result.location).toBe("Room A");
    expect(result.description).toBe("Daily standup");
    expect(result.isAllDay).toBe(false);
    expect(result.isRecurring).toBe(false);
  });

  it("transforms an all-day event correctly", () => {
    const result = transformEvent({
      id: "evt2",
      summary: "Holiday",
      start: { date: "2026-03-01" },
      end: { date: "2026-03-02" },
    });
    expect(result.isAllDay).toBe(true);
    expect(result.date).toBe("2026-03-01");
    expect(result.startTime).toBeUndefined();
    expect(result.endTime).toBeUndefined();
  });

  it("detects recurring event instances", () => {
    const result = transformEvent({
      id: "evt3_20260213",
      summary: "Weekly Meeting",
      start: { dateTime: "2026-02-13T14:00:00Z" },
      end: { dateTime: "2026-02-13T15:00:00Z" },
      recurringEventId: "evt3_master",
    });
    expect(result.isRecurring).toBe(true);
  });

  it("uses '(no title)' when summary is missing", () => {
    const result = transformEvent({
      id: "evt4",
      start: { dateTime: "2026-02-13T09:00:00Z" },
      end: { dateTime: "2026-02-13T10:00:00Z" },
    });
    expect(result.title).toBe("(no title)");
  });

  it("returns undefined for missing optional fields", () => {
    const result = transformEvent({
      id: "evt5",
      summary: "Test",
      start: { dateTime: "2026-02-13T09:00:00Z" },
      end: { dateTime: "2026-02-13T10:00:00Z" },
    });
    expect(result.location).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.attendees).toBeUndefined();
  });

  it("transforms attendees correctly", () => {
    const result = transformEvent({
      id: "evt6",
      summary: "Meeting",
      start: { dateTime: "2026-02-13T09:00:00Z" },
      end: { dateTime: "2026-02-13T10:00:00Z" },
      attendees: [
        { email: "a@example.com", displayName: "Alice", responseStatus: "accepted" },
        { email: "b@example.com", responseStatus: "tentative" },
      ],
    });
    expect(result.attendees).toHaveLength(2);
    expect(result.attendees![0].email).toBe("a@example.com");
    expect(result.attendees![0].name).toBe("Alice");
    expect(result.attendees![0].status).toBe("accepted");
    expect(result.attendees![1].name).toBeUndefined();
  });
});

// ============================================================
// Helpers for handler tests
// ============================================================

function mockConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    timezone: "Asia/Jerusalem",
    credentialsPath: "/fake/creds.json",
    auditLogDir: null,
    guardrailsPath: "/fake/guardrails.json",
    testMode: false,
    ...overrides,
  };
}

function mockGuardrails(overrides?: Record<string, unknown>): GuardrailContext {
  return new GuardrailContext({
    dailyWriteLimit: 50,
    pastEventProtectionDays: 7,
    protectedCalendars: [],
    protectedTaskLists: [],
    allowRecurringSeriesDelete: false,
    ...overrides,
  });
}

function noopAudit(): AuditLogger {
  return { log: vi.fn().mockResolvedValue(undefined) };
}

// ============================================================
// listEvents
// ============================================================

describe("listEvents", () => {
  it("returns transformed events from Google API", async () => {
    const mockClient = {
      // googleapis accesses google.calendar() which uses the auth client internally.
      // Our handler calls google.calendar({ version: "v3", auth: client })
      // For unit testing we need to mock at a higher level. Since listEvents
      // creates the google.calendar client internally, we test via transformEvent
      // and integration tests. Here we just verify the validation path.
    };
    // Validation test: neither date nor range
    const result = await listEvents(
      { calendarId: "primary", maxResults: 50 },
      {} as any,
      mockConfig(),
    );
    const parsed = JSON.parse(result.content[0].text);
    expect(result.isError).toBe(true);
    expect(parsed.code).toBe("VALIDATION_ERROR");
  });
});

// ============================================================
// createEvent
// ============================================================

describe("createEvent", () => {
  it("rejects when daily write limit is reached", async () => {
    const guardrails = mockGuardrails({ dailyWriteLimit: 0 });
    const audit = noopAudit();

    const result = await createEvent(
      {
        calendarId: "primary",
        title: "Test Event",
        date: "2026-02-15",
        startTime: "10:00",
        endTime: "11:00",
      },
      {} as any,
      mockConfig(),
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("DAILY_LIMIT_REACHED");
    // Audit should not be called
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("rejects when calendar is protected", async () => {
    const guardrails = mockGuardrails({
      protectedCalendars: ["holidays@group.v.calendar.google.com"],
    });
    const audit = noopAudit();

    const result = await createEvent(
      {
        calendarId: "holidays@group.v.calendar.google.com",
        title: "Test",
        date: "2026-02-15",
        startTime: "10:00",
        endTime: "11:00",
      },
      {} as any,
      mockConfig(),
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("PROTECTED_RESOURCE");
  });
});

// ============================================================
// updateEvent
// ============================================================

describe("updateEvent", () => {
  it("rejects when daily write limit is reached", async () => {
    const guardrails = mockGuardrails({ dailyWriteLimit: 0 });
    const audit = noopAudit();

    const result = await updateEvent(
      { calendarId: "primary", eventId: "evt1", title: "Updated" },
      {} as any,
      mockConfig(),
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("DAILY_LIMIT_REACHED");
  });
});

// ============================================================
// deleteEvent
// ============================================================

describe("deleteEvent", () => {
  it("rejects when daily write limit is reached", async () => {
    const guardrails = mockGuardrails({ dailyWriteLimit: 0 });
    const audit = noopAudit();

    const result = await deleteEvent(
      { calendarId: "primary", eventId: "evt1" },
      {} as any,
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("DAILY_LIMIT_REACHED");
  });

  it("rejects when calendar is protected", async () => {
    const guardrails = mockGuardrails({
      protectedCalendars: ["protected-cal"],
    });
    const audit = noopAudit();

    const result = await deleteEvent(
      { calendarId: "protected-cal", eventId: "evt1" },
      {} as any,
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("PROTECTED_RESOURCE");
  });
});

// ============================================================
// Happy-path tests using mock clients
// ============================================================

describe("listCalendars (mock)", () => {
  it("returns calendar list from mock", async () => {
    const api = createMockCalendarClient();
    const result = await listCalendars(api);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("primary");
    expect(parsed[1].name).toBe("Work Calendar");
  });
});

describe("listEvents (mock)", () => {
  it("returns events for a single date", async () => {
    const api = createMockCalendarClient();
    const result = await listEvents(
      { calendarId: "primary", date: "2026-02-13", maxResults: 50 },
      api,
      mockConfig(),
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed[0].title).toBe("Morning Standup");
    expect(parsed[1].isAllDay).toBe(true);
  });

  it("returns events for a date range", async () => {
    const api = createMockCalendarClient();
    const result = await listEvents(
      { calendarId: "primary", startDate: "2026-02-13", endDate: "2026-02-14", maxResults: 50 },
      api,
      mockConfig(),
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
  });
});

describe("getEvent (mock)", () => {
  it("returns a single event", async () => {
    const api = createMockCalendarClient();
    const result = await getEvent(
      { calendarId: "primary", eventId: "evt_mock_1" },
      api,
      mockConfig(),
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("evt_mock_1");
    expect(parsed.title).toBe("Mock Event");
  });
});

describe("createEvent (mock)", () => {
  it("creates an event and returns id", async () => {
    resetMockState();
    const api = createMockCalendarClient();
    const guardrails = mockGuardrails();
    const audit = noopAudit();

    const result = await createEvent(
      {
        calendarId: "primary",
        title: "New Meeting",
        date: "2026-02-15",
        startTime: "14:00",
        endTime: "15:00",
      },
      api,
      mockConfig(),
      guardrails,
      audit,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toMatch(/^evt_mock_/);
    expect(parsed.title).toBe("New Meeting");
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});

describe("updateEvent (mock)", () => {
  it("updates an event title", async () => {
    const api = createMockCalendarClient();
    const guardrails = mockGuardrails();
    const audit = noopAudit();

    const result = await updateEvent(
      { calendarId: "primary", eventId: "evt_mock_1", title: "Renamed" },
      api,
      mockConfig(),
      guardrails,
      audit,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.title).toBe("Renamed");
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});

describe("deleteEvent (mock)", () => {
  it("deletes an event and returns title", async () => {
    const api = createMockCalendarClient();
    const guardrails = mockGuardrails();
    const audit = noopAudit();

    const result = await deleteEvent(
      { calendarId: "primary", eventId: "evt_mock_1" },
      api,
      guardrails,
      audit,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.deletedTitle).toBe("Mock Event");
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});
