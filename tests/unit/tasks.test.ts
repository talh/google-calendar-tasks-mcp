import { describe, it, expect, vi } from "vitest";
import {
  transformTask,
  listTaskLists,
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  completeTask,
  moveTask,
} from "../../src/tasks.js";
import { GuardrailContext } from "../../src/guardrails.js";
import type { AuditLogger } from "../../src/audit.js";
import { createMockTasksClient, resetMockState } from "../../src/test-mocks.js";

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

// ============================================================
// Happy-path tests using mock clients
// ============================================================

describe("listTaskLists (mock)", () => {
  it("returns task lists", async () => {
    const api = createMockTasksClient();
    const result = await listTaskLists(api);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe("My Tasks");
    expect(parsed[1].title).toBe("Work Tasks");
  });
});

describe("listTasks (mock)", () => {
  it("returns tasks with transformed due dates", async () => {
    const api = createMockTasksClient();
    const result = await listTasks(
      { showCompleted: true, maxResults: 100 },
      api,
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed[0].title).toBe("Buy groceries");
    expect(parsed[0].due).toBe("2026-02-15");
  });
});

describe("getTask (mock)", () => {
  it("returns a single task", async () => {
    const api = createMockTasksClient();
    const result = await getTask(
      { taskListId: "@default", taskId: "task_mock_1" },
      api,
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("task_mock_1");
    expect(parsed.title).toBe("Mock Task");
  });
});

describe("createTask (mock)", () => {
  it("creates a task and returns id", async () => {
    resetMockState();
    const api = createMockTasksClient();
    const guardrails = mockGuardrails();
    const audit = noopAudit();

    const result = await createTask(
      { title: "New Task", due: "2026-02-20", notes: "Some notes" },
      api,
      guardrails,
      audit,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toMatch(/^task_mock_/);
    expect(parsed.title).toBe("New Task");
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});

describe("updateTask (mock)", () => {
  it("updates a task title", async () => {
    const api = createMockTasksClient();
    const guardrails = mockGuardrails();
    const audit = noopAudit();

    const result = await updateTask(
      { taskListId: "@default", taskId: "task_mock_1", title: "Renamed Task" },
      api,
      guardrails,
      audit,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.title).toBe("Renamed Task");
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});

describe("deleteTask (mock)", () => {
  it("deletes a task and returns title", async () => {
    const api = createMockTasksClient();
    const guardrails = mockGuardrails();
    const audit = noopAudit();

    const result = await deleteTask(
      { taskListId: "@default", taskId: "task_mock_1" },
      api,
      guardrails,
      audit,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
    expect(parsed.deletedTitle).toBe("Mock Task");
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});

describe("completeTask (mock)", () => {
  it("marks a task as completed", async () => {
    const api = createMockTasksClient();
    const guardrails = mockGuardrails();
    const audit = noopAudit();

    const result = await completeTask(
      { taskListId: "@default", taskId: "task_mock_1" },
      api,
      guardrails,
      audit,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("completed");
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});

describe("moveTask (mock)", () => {
  it("moves a task between lists", async () => {
    resetMockState();
    const api = createMockTasksClient();
    const guardrails = mockGuardrails();
    const audit = noopAudit();

    const result = await moveTask(
      { sourceListId: "list_default", taskId: "task_mock_1", destinationListId: "list_work" },
      api,
      guardrails,
      audit,
    );

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toMatch(/^task_mock_/);
    expect(parsed.newListId).toBe("list_work");
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});
