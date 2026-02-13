import { describe, it, expect } from "vitest";
import { GuardrailContext } from "../../src/guardrails.js";
import { GuardrailError } from "../../src/errors.js";

function makeContext(overrides = {}) {
  return new GuardrailContext({
    dailyWriteLimit: 5,
    pastEventProtectionDays: 7,
    protectedCalendars: ["holidays@group.v.calendar.google.com"],
    protectedTaskLists: ["protected-list-id"],
    allowRecurringSeriesDelete: false,
    ...overrides,
  });
}

describe("write limit", () => {
  it("starts at 0", () => {
    const ctx = makeContext();
    expect(ctx.getWriteCount()).toBe(0);
  });

  it("allows writes under the limit", () => {
    const ctx = makeContext({ dailyWriteLimit: 3 });
    expect(() => ctx.checkWriteLimit()).not.toThrow();
    ctx.incrementWriteCounter();
    expect(() => ctx.checkWriteLimit()).not.toThrow();
    ctx.incrementWriteCounter();
    expect(() => ctx.checkWriteLimit()).not.toThrow();
    ctx.incrementWriteCounter();
    expect(ctx.getWriteCount()).toBe(3);
  });

  it("rejects when limit is reached", () => {
    const ctx = makeContext({ dailyWriteLimit: 3 });
    ctx.incrementWriteCounter(3);
    expect(() => ctx.checkWriteLimit()).toThrow(GuardrailError);
    expect(() => ctx.checkWriteLimit()).toThrow(/Daily write limit reached/);
  });

  it("resets counter on date change", () => {
    const ctx = makeContext({ dailyWriteLimit: 3 });
    ctx.incrementWriteCounter(3);
    expect(() => ctx.checkWriteLimit()).toThrow(GuardrailError);

    // Simulate date change
    ctx.setDateForTesting("2020-01-01");
    expect(() => ctx.checkWriteLimit()).not.toThrow();
    expect(ctx.getWriteCount()).toBe(0);
  });

  it("checks cost of 2 correctly (task move)", () => {
    const ctx = makeContext({ dailyWriteLimit: 5 });
    ctx.incrementWriteCounter(3);
    // 3 + 2 = 5, exactly at limit — should be allowed
    expect(() => ctx.checkWriteLimit(2)).not.toThrow();
  });

  it("rejects cost of 2 when it would exceed limit", () => {
    const ctx = makeContext({ dailyWriteLimit: 5 });
    ctx.incrementWriteCounter(4);
    // 4 + 2 = 6 > 5 — should reject
    expect(() => ctx.checkWriteLimit(2)).toThrow(GuardrailError);
  });

  it("increments by cost correctly", () => {
    const ctx = makeContext();
    ctx.incrementWriteCounter(2);
    expect(ctx.getWriteCount()).toBe(2);
    ctx.incrementWriteCounter(3);
    expect(ctx.getWriteCount()).toBe(5);
  });
});

describe("protected calendar", () => {
  it("blocks listed calendars", () => {
    const ctx = makeContext();
    expect(() =>
      ctx.checkProtectedCalendar("holidays@group.v.calendar.google.com"),
    ).toThrow(GuardrailError);
    expect(() =>
      ctx.checkProtectedCalendar("holidays@group.v.calendar.google.com"),
    ).toThrow(/protected/);
  });

  it("allows unlisted calendars", () => {
    const ctx = makeContext();
    expect(() => ctx.checkProtectedCalendar("primary")).not.toThrow();
    expect(() =>
      ctx.checkProtectedCalendar("work@example.com"),
    ).not.toThrow();
  });
});

describe("protected task list", () => {
  it("blocks listed task lists", () => {
    const ctx = makeContext();
    expect(() =>
      ctx.checkProtectedTaskList("protected-list-id"),
    ).toThrow(GuardrailError);
  });

  it("allows unlisted task lists", () => {
    const ctx = makeContext();
    expect(() => ctx.checkProtectedTaskList("@default")).not.toThrow();
    expect(() =>
      ctx.checkProtectedTaskList("some-other-list"),
    ).not.toThrow();
  });
});

describe("past event protection", () => {
  function daysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString();
  }

  it("allows event that ended 6 days ago (under threshold)", () => {
    const ctx = makeContext({ pastEventProtectionDays: 7 });
    expect(() => ctx.checkPastEventProtection(daysAgo(6))).not.toThrow();
  });

  it("blocks event that ended 8 days ago (over threshold)", () => {
    const ctx = makeContext({ pastEventProtectionDays: 7 });
    expect(() => ctx.checkPastEventProtection(daysAgo(8))).toThrow(
      GuardrailError,
    );
    expect(() => ctx.checkPastEventProtection(daysAgo(8))).toThrow(
      /more than 7 days ago/,
    );
  });

  it("blocks event at exactly the boundary (7 days ago)", () => {
    const ctx = makeContext({ pastEventProtectionDays: 7 });
    expect(() => ctx.checkPastEventProtection(daysAgo(7))).toThrow(
      GuardrailError,
    );
  });

  it("allows recent events", () => {
    const ctx = makeContext({ pastEventProtectionDays: 7 });
    // 1 hour ago
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(() => ctx.checkPastEventProtection(recent)).not.toThrow();
  });

  it("allows future events", () => {
    const ctx = makeContext({ pastEventProtectionDays: 7 });
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(() => ctx.checkPastEventProtection(future)).not.toThrow();
  });
});

describe("recurring series delete", () => {
  it("blocks series master when allowRecurringSeriesDelete is false", () => {
    const ctx = makeContext({ allowRecurringSeriesDelete: false });
    const seriesMaster = {
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      recurringEventId: undefined,
    };
    expect(() => ctx.checkRecurringSeriesDelete(seriesMaster)).toThrow(
      GuardrailError,
    );
    expect(() => ctx.checkRecurringSeriesDelete(seriesMaster)).toThrow(
      /recurring event series/,
    );
  });

  it("allows series master when allowRecurringSeriesDelete is true", () => {
    const ctx = makeContext({ allowRecurringSeriesDelete: true });
    const seriesMaster = {
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"],
      recurringEventId: undefined,
    };
    expect(() => ctx.checkRecurringSeriesDelete(seriesMaster)).not.toThrow();
  });

  it("always allows deleting a single instance (has recurringEventId)", () => {
    const ctx = makeContext({ allowRecurringSeriesDelete: false });
    const instance = {
      recurrence: undefined,
      recurringEventId: "master-event-id",
    };
    expect(() => ctx.checkRecurringSeriesDelete(instance)).not.toThrow();
  });

  it("allows deleting a non-recurring event", () => {
    const ctx = makeContext({ allowRecurringSeriesDelete: false });
    const normal = {
      recurrence: undefined,
      recurringEventId: undefined,
    };
    expect(() => ctx.checkRecurringSeriesDelete(normal)).not.toThrow();
  });
});

describe("resetForTesting", () => {
  it("resets the write counter", () => {
    const ctx = makeContext();
    ctx.incrementWriteCounter(3);
    expect(ctx.getWriteCount()).toBe(3);
    ctx.resetForTesting();
    expect(ctx.getWriteCount()).toBe(0);
  });
});
