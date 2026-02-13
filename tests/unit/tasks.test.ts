import { describe, it, expect, vi } from "vitest";
import {
  transformTask,
  createTask,
  updateTask,
  deleteTask,
  completeTask,
  moveTask,
} from "../../src/tasks.js";
import { GuardrailContext } from "../../src/guardrails.js";
import type { AuditLogger } from "../../src/audit.js";

// ============================================================
// transformTask
// ============================================================

describe("transformTask", () => {
  it("transforms a task with due date", () => {
    const result = transformTask({
      id: "t1",
      title: "Buy groceries",
      status: "needsAction",
      due: "2026-02-15T00:00:00.000Z",
      notes: "Milk, eggs, bread",
      updated: "2026-02-13T10:00:00.000Z",
    });
    expect(result.id).toBe("t1");
    expect(result.title).toBe("Buy groceries");
    expect(result.status).toBe("needsAction");
    expect(result.due).toBe("2026-02-15");
    expect(result.notes).toBe("Milk, eggs, bread");
    expect(result.updated).toBe("2026-02-13T10:00:00.000Z");
  });

  it("transforms a task without due date", () => {
    const result = transformTask({
      id: "t2",
      title: "Think about stuff",
      status: "needsAction",
    });
    expect(result.due).toBeUndefined();
  });

  it("uses '(no title)' when title is missing", () => {
    const result = transformTask({
      id: "t3",
      status: "needsAction",
    });
    expect(result.title).toBe("(no title)");
  });

  it("returns undefined for missing notes", () => {
    const result = transformTask({
      id: "t4",
      title: "Test",
      status: "needsAction",
    });
    expect(result.notes).toBeUndefined();
  });

  it("transforms a completed task", () => {
    const result = transformTask({
      id: "t5",
      title: "Done task",
      status: "completed",
      due: "2026-02-10T00:00:00.000Z",
    });
    expect(result.status).toBe("completed");
    expect(result.due).toBe("2026-02-10");
  });
});

// ============================================================
// Helpers
// ============================================================

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
// createTask — guardrail checks
// ============================================================

describe("createTask", () => {
  it("rejects when daily write limit is reached", async () => {
    const guardrails = mockGuardrails({ dailyWriteLimit: 0 });
    const audit = noopAudit();

    const result = await createTask(
      { title: "Test task" },
      {} as any,
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("DAILY_LIMIT_REACHED");
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("rejects when task list is protected", async () => {
    const guardrails = mockGuardrails({
      protectedTaskLists: ["protected-list"],
    });
    const audit = noopAudit();

    const result = await createTask(
      { taskListId: "protected-list", title: "Test" },
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
// updateTask — guardrail checks
// ============================================================

describe("updateTask", () => {
  it("rejects when daily write limit is reached", async () => {
    const guardrails = mockGuardrails({ dailyWriteLimit: 0 });
    const audit = noopAudit();

    const result = await updateTask(
      { taskListId: "@default", taskId: "t1", title: "Updated" },
      {} as any,
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("DAILY_LIMIT_REACHED");
  });

  it("rejects when task list is protected", async () => {
    const guardrails = mockGuardrails({
      protectedTaskLists: ["protected-list"],
    });
    const audit = noopAudit();

    const result = await updateTask(
      { taskListId: "protected-list", taskId: "t1", title: "Updated" },
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
// deleteTask — guardrail checks
// ============================================================

describe("deleteTask", () => {
  it("rejects when daily write limit is reached", async () => {
    const guardrails = mockGuardrails({ dailyWriteLimit: 0 });
    const audit = noopAudit();

    const result = await deleteTask(
      { taskListId: "@default", taskId: "t1" },
      {} as any,
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("DAILY_LIMIT_REACHED");
  });
});

// ============================================================
// completeTask — guardrail checks
// ============================================================

describe("completeTask", () => {
  it("rejects when daily write limit is reached", async () => {
    const guardrails = mockGuardrails({ dailyWriteLimit: 0 });
    const audit = noopAudit();

    const result = await completeTask(
      { taskListId: "@default", taskId: "t1" },
      {} as any,
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("DAILY_LIMIT_REACHED");
  });

  it("rejects when task list is protected", async () => {
    const guardrails = mockGuardrails({
      protectedTaskLists: ["protected-list"],
    });
    const audit = noopAudit();

    const result = await completeTask(
      { taskListId: "protected-list", taskId: "t1" },
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
// moveTask — guardrail checks
// ============================================================

describe("moveTask", () => {
  it("rejects when daily write limit is reached (cost 2)", async () => {
    const guardrails = mockGuardrails({ dailyWriteLimit: 1 });
    const audit = noopAudit();

    const result = await moveTask(
      { sourceListId: "list-a", taskId: "t1", destinationListId: "list-b" },
      {} as any,
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("DAILY_LIMIT_REACHED");
  });

  it("rejects when source list is protected", async () => {
    const guardrails = mockGuardrails({
      protectedTaskLists: ["protected-list"],
    });
    const audit = noopAudit();

    const result = await moveTask(
      { sourceListId: "protected-list", taskId: "t1", destinationListId: "list-b" },
      {} as any,
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("PROTECTED_RESOURCE");
  });

  it("rejects when destination list is protected", async () => {
    const guardrails = mockGuardrails({
      protectedTaskLists: ["protected-list"],
    });
    const audit = noopAudit();

    const result = await moveTask(
      { sourceListId: "list-a", taskId: "t1", destinationListId: "protected-list" },
      {} as any,
      guardrails,
      audit,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe("PROTECTED_RESOURCE");
  });
});
