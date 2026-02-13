/**
 * Integration tests that exercise the MCP server end-to-end.
 *
 * The server is launched as a subprocess with GOOGLE_MCP_TEST_MODE=true
 * and driven via the MCP Client SDK over stdio.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const SERVER_ENTRY = path.resolve("build/index.js");

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      GOOGLE_MCP_TEST_MODE: "true",
    },
  });

  client = new Client({
    name: "integration-test-client",
    version: "1.0.0",
  });

  await client.connect(transport);
}, 15_000);

afterAll(async () => {
  await client.close();
});

// ============================================================
// Tool discovery
// ============================================================

describe("tool discovery", () => {
  it("lists all 14 tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "calendar_create_event",
      "calendar_delete_event",
      "calendar_get_event",
      "calendar_list_calendars",
      "calendar_list_events",
      "calendar_update_event",
      "tasks_complete",
      "tasks_create",
      "tasks_delete",
      "tasks_get",
      "tasks_list",
      "tasks_list_tasklists",
      "tasks_move",
      "tasks_update",
    ]);
  });
});

// ============================================================
// Calendar tools
// ============================================================

describe("calendar tools", () => {
  it("calendar_list_calendars returns calendars", async () => {
    const result = await client.callTool({
      name: "calendar_list_calendars",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("primary");
  });

  it("calendar_list_events returns events for a date", async () => {
    const result = await client.callTool({
      name: "calendar_list_events",
      arguments: { date: "2026-02-13" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed[0].title).toBe("Morning Standup");
  });

  it("calendar_list_events returns validation error without date", async () => {
    const result = await client.callTool({
      name: "calendar_list_events",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.code).toBe("VALIDATION_ERROR");
  });

  it("calendar_get_event returns a single event", async () => {
    const result = await client.callTool({
      name: "calendar_get_event",
      arguments: { eventId: "evt_mock_1" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.id).toBe("evt_mock_1");
  });

  it("calendar_create_event creates and returns event", async () => {
    const result = await client.callTool({
      name: "calendar_create_event",
      arguments: {
        title: "Integration Test Event",
        date: "2026-02-20",
        startTime: "10:00",
        endTime: "11:00",
      },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.id).toMatch(/^evt_mock_/);
    expect(parsed.title).toBe("Integration Test Event");
  });

  it("calendar_update_event updates event title", async () => {
    const result = await client.callTool({
      name: "calendar_update_event",
      arguments: { eventId: "evt_mock_1", title: "Updated Title" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.title).toBe("Updated Title");
  });

  it("calendar_delete_event deletes an event", async () => {
    const result = await client.callTool({
      name: "calendar_delete_event",
      arguments: { eventId: "evt_mock_1" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.success).toBe(true);
  });
});

// ============================================================
// Task tools
// ============================================================

describe("task tools", () => {
  it("tasks_list_tasklists returns task lists", async () => {
    const result = await client.callTool({
      name: "tasks_list_tasklists",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].title).toBe("My Tasks");
  });

  it("tasks_list returns tasks", async () => {
    const result = await client.callTool({
      name: "tasks_list",
      arguments: {},
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.length).toBeGreaterThanOrEqual(2);
    expect(parsed[0].title).toBe("Buy groceries");
    expect(parsed[0].due).toBe("2026-02-15");
  });

  it("tasks_get returns a single task", async () => {
    const result = await client.callTool({
      name: "tasks_get",
      arguments: { taskListId: "@default", taskId: "task_mock_1" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.id).toBe("task_mock_1");
  });

  it("tasks_create creates a task", async () => {
    const result = await client.callTool({
      name: "tasks_create",
      arguments: { title: "Integration Test Task", due: "2026-03-01" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.id).toMatch(/^task_mock_/);
    expect(parsed.title).toBe("Integration Test Task");
  });

  it("tasks_update updates a task", async () => {
    const result = await client.callTool({
      name: "tasks_update",
      arguments: {
        taskListId: "@default",
        taskId: "task_mock_1",
        title: "Updated Task",
      },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.title).toBe("Updated Task");
  });

  it("tasks_complete marks a task as completed", async () => {
    const result = await client.callTool({
      name: "tasks_complete",
      arguments: { taskListId: "@default", taskId: "task_mock_1" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.status).toBe("completed");
  });

  it("tasks_delete deletes a task", async () => {
    const result = await client.callTool({
      name: "tasks_delete",
      arguments: { taskListId: "@default", taskId: "task_mock_1" },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.success).toBe(true);
  });

  it("tasks_move moves a task between lists", async () => {
    const result = await client.callTool({
      name: "tasks_move",
      arguments: {
        sourceListId: "list_default",
        taskId: "task_mock_1",
        destinationListId: "list_work",
      },
    });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse((result.content as any)[0].text);
    expect(parsed.newListId).toBe("list_work");
  });
});
