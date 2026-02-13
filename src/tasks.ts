import type { GuardrailContext } from "./guardrails.js";
import type { AuditLogger } from "./audit.js";
import { successResult, errorResult, type ToolResult } from "./types.js";
import { GuardrailError, apiError } from "./errors.js";

// ============================================================
// Types
// ============================================================

/** The subset of google.tasks("v1") we actually use */
export interface TasksApi {
  tasklists: { list: (params?: any) => Promise<{ data: any }> };
  tasks: {
    list: (params: any) => Promise<{ data: any }>;
    get: (params: any) => Promise<{ data: any }>;
    insert: (params: any) => Promise<{ data: any }>;
    patch: (params: any) => Promise<{ data: any }>;
    delete: (params: any) => Promise<any>;
  };
}

export interface ListTasksParams {
  taskListId?: string;
  showCompleted: boolean;
  maxResults: number;
}

export interface GetTaskParams {
  taskListId: string;
  taskId: string;
}

export interface CreateTaskParams {
  taskListId?: string;
  title: string;
  due?: string;
  notes?: string;
}

export interface UpdateTaskParams {
  taskListId: string;
  taskId: string;
  title?: string;
  due?: string;
  notes?: string;
  status?: "needsAction" | "completed";
}

export interface DeleteTaskParams {
  taskListId: string;
  taskId: string;
}

export interface CompleteTaskParams {
  taskListId: string;
  taskId: string;
}

export interface MoveTaskParams {
  sourceListId: string;
  taskId: string;
  destinationListId: string;
}

// ============================================================
// Response transformation
// ============================================================

export function transformTask(task: { id?: string | null; title?: string | null; status?: string | null; due?: string | null; notes?: string | null; updated?: string | null }) {
  return {
    id: task.id,
    title: task.title ?? "(no title)",
    status: task.status,
    due: task.due ? task.due.slice(0, 10) : undefined,
    notes: task.notes ?? undefined,
    updated: task.updated,
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
// Helpers
// ============================================================

function toRfc3339Date(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function resolveListId(taskListId?: string): string {
  return taskListId ?? "@default";
}

// ============================================================
// Handlers
// ============================================================

export async function listTaskLists(
  api: TasksApi,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const { data } = await api.tasklists.list();

    const lists = (data.items ?? []).map((l: any) => ({
      id: l.id,
      title: l.title,
    }));

    return successResult(lists);
  });
}

export async function listTasks(
  params: ListTasksParams,
  api: TasksApi,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const { data } = await api.tasks.list({
      tasklist: resolveListId(params.taskListId),
      showCompleted: params.showCompleted,
      showHidden: params.showCompleted,
      maxResults: params.maxResults,
    });

    const tasks = (data.items ?? []).map(transformTask);
    return successResult(tasks);
  });
}

export async function getTask(
  params: GetTaskParams,
  api: TasksApi,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const { data } = await api.tasks.get({
      tasklist: params.taskListId,
      task: params.taskId,
    });
    return successResult(transformTask(data));
  });
}

export async function createTask(
  params: CreateTaskParams,
  api: TasksApi,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const listId = resolveListId(params.taskListId);
    guardrails.checkWriteLimit(1);
    guardrails.checkProtectedTaskList(listId);

    const body: Record<string, any> = {
      title: params.title,
    };
    if (params.due) {
      body.due = toRfc3339Date(params.due);
    }
    if (params.notes) {
      body.notes = params.notes;
    }

    const { data } = await api.tasks.insert({
      tasklist: listId,
      requestBody: body,
    });

    guardrails.incrementWriteCounter(1);

    try {
      await audit.log({
        operation: "create",
        service: "tasks",
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
      title: data.title,
      due: data.due ? data.due.slice(0, 10) : undefined,
    });
  });
}

export async function updateTask(
  params: UpdateTaskParams,
  api: TasksApi,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(1);
    guardrails.checkProtectedTaskList(params.taskListId);

    // Fetch existing task for merge
    const { data: existing } = await api.tasks.get({
      tasklist: params.taskListId,
      task: params.taskId,
    });

    const patch: Record<string, any> = {};
    const changes: Record<string, unknown> = {};

    if (params.title !== undefined) {
      patch.title = params.title;
      changes.title = params.title;
    }
    if (params.due !== undefined) {
      patch.due = toRfc3339Date(params.due);
      changes.due = params.due;
    }
    if (params.notes !== undefined) {
      patch.notes = params.notes;
      changes.notes = params.notes;
    }
    if (params.status !== undefined) {
      patch.status = params.status;
      changes.status = params.status;
    }

    const { data } = await api.tasks.patch({
      tasklist: params.taskListId,
      task: params.taskId,
      requestBody: patch,
    });

    guardrails.incrementWriteCounter(1);

    try {
      await audit.log({
        operation: "update",
        service: "tasks",
        title: data.title ?? params.title ?? existing.title ?? "",
        googleId: data.id ?? params.taskId,
        changes,
        timestamp: new Date().toISOString(),
        source: "mcp",
      });
    } catch (err) {
      console.error("[audit] Failed to write audit entry:", err);
    }

    return successResult({
      id: data.id,
      title: data.title,
      status: data.status,
      due: data.due ? data.due.slice(0, 10) : undefined,
    });
  });
}

export async function deleteTask(
  params: DeleteTaskParams,
  api: TasksApi,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(1);
    guardrails.checkProtectedTaskList(params.taskListId);

    // Fetch existing task for audit title
    const { data: existing } = await api.tasks.get({
      tasklist: params.taskListId,
      task: params.taskId,
    });

    await api.tasks.delete({
      tasklist: params.taskListId,
      task: params.taskId,
    });

    guardrails.incrementWriteCounter(1);

    try {
      await audit.log({
        operation: "delete",
        service: "tasks",
        title: existing.title ?? "(no title)",
        googleId: params.taskId,
        timestamp: new Date().toISOString(),
        source: "mcp",
      });
    } catch (err) {
      console.error("[audit] Failed to write audit entry:", err);
    }

    return successResult({
      success: true,
      deletedTitle: existing.title ?? "(no title)",
    });
  });
}

export async function completeTask(
  params: CompleteTaskParams,
  api: TasksApi,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(1);
    guardrails.checkProtectedTaskList(params.taskListId);

    const { data } = await api.tasks.patch({
      tasklist: params.taskListId,
      task: params.taskId,
      requestBody: { status: "completed" },
    });

    guardrails.incrementWriteCounter(1);

    try {
      await audit.log({
        operation: "complete",
        service: "tasks",
        title: data.title ?? "(no title)",
        googleId: data.id ?? params.taskId,
        timestamp: new Date().toISOString(),
        source: "mcp",
      });
    } catch (err) {
      console.error("[audit] Failed to write audit entry:", err);
    }

    return successResult({
      id: data.id,
      title: data.title,
      status: "completed",
    });
  });
}

export async function moveTask(
  params: MoveTaskParams,
  api: TasksApi,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(2);
    guardrails.checkProtectedTaskList(params.sourceListId);
    guardrails.checkProtectedTaskList(params.destinationListId);

    // 1. Get the task from source
    const { data: task } = await api.tasks.get({
      tasklist: params.sourceListId,
      task: params.taskId,
    });

    // 2. Create in destination
    const { data: newTask } = await api.tasks.insert({
      tasklist: params.destinationListId,
      requestBody: {
        title: task.title,
        notes: task.notes,
        due: task.due,
        status: task.status,
      },
    });

    // 3. Delete from source
    await api.tasks.delete({
      tasklist: params.sourceListId,
      task: params.taskId,
    });

    guardrails.incrementWriteCounter(2);

    try {
      await audit.log({
        operation: "create",
        service: "tasks",
        title: task.title ?? "(no title)",
        googleId: newTask.id ?? "",
        changes: {
          movedFrom: params.sourceListId,
          movedTo: params.destinationListId,
        },
        timestamp: new Date().toISOString(),
        source: "mcp",
      });
    } catch (err) {
      console.error("[audit] Failed to write audit entry:", err);
    }

    return successResult({
      id: newTask.id,
      title: newTask.title,
      newListId: params.destinationListId,
    });
  });
}
