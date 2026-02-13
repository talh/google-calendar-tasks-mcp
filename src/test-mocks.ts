/**
 * Mock Google API clients for test mode (GOOGLE_MCP_TEST_MODE=true).
 *
 * These return canned data that exercises the response transformation
 * and guardrail logic without hitting real Google APIs.
 */

let insertCounter = 0;

function nextId(prefix: string): string {
  insertCounter++;
  return `${prefix}_mock_${insertCounter}`;
}

export function createMockCalendarClient() {
  return {
    calendarList: {
      list: async () => ({
        data: {
          items: [
            { id: "primary", summary: "Primary Calendar", primary: true, accessRole: "owner" },
            { id: "work@example.com", summary: "Work Calendar", primary: false, accessRole: "writer" },
          ],
        },
      }),
    },
    events: {
      list: async (params: any) => ({
        data: {
          items: [
            {
              id: "evt_mock_1",
              summary: "Morning Standup",
              start: { dateTime: `${params.timeMin?.slice(0, 10) ?? "2026-02-13"}T09:00:00+02:00` },
              end: { dateTime: `${params.timeMin?.slice(0, 10) ?? "2026-02-13"}T09:30:00+02:00` },
              location: "Room A",
            },
            {
              id: "evt_mock_2",
              summary: "All Day Event",
              start: { date: params.timeMin?.slice(0, 10) ?? "2026-02-13" },
              end: { date: params.timeMin?.slice(0, 10) ?? "2026-02-13" },
            },
            {
              id: "evt_mock_3",
              summary: "Weekly Recurring",
              start: { dateTime: `${params.timeMin?.slice(0, 10) ?? "2026-02-13"}T14:00:00+02:00` },
              end: { dateTime: `${params.timeMin?.slice(0, 10) ?? "2026-02-13"}T15:00:00+02:00` },
              recurringEventId: "evt_master_1",
            },
          ],
        },
      }),
      get: async (params: any) => ({
        data: {
          id: params.eventId,
          summary: "Mock Event",
          start: { dateTime: "2026-02-13T10:00:00+02:00" },
          end: { dateTime: "2026-02-13T11:00:00+02:00" },
          location: "Test Location",
          description: "Test Description",
        },
      }),
      insert: async (params: any) => {
        const id = nextId("evt");
        return {
          data: {
            id,
            summary: params.requestBody?.summary,
            start: params.requestBody?.start,
            end: params.requestBody?.end,
          },
        };
      },
      patch: async (params: any) => ({
        data: {
          id: params.eventId,
          summary: params.requestBody?.summary ?? "Mock Event",
          start: params.requestBody?.start ?? { dateTime: "2026-02-13T10:00:00+02:00" },
          end: params.requestBody?.end ?? { dateTime: "2026-02-13T11:00:00+02:00" },
        },
      }),
      delete: async () => {
        // void
      },
    },
  };
}

export function createMockTasksClient() {
  return {
    tasklists: {
      list: async () => ({
        data: {
          items: [
            { id: "list_default", title: "My Tasks" },
            { id: "list_work", title: "Work Tasks" },
          ],
        },
      }),
    },
    tasks: {
      list: async () => ({
        data: {
          items: [
            {
              id: "task_mock_1",
              title: "Buy groceries",
              status: "needsAction",
              due: "2026-02-15T00:00:00.000Z",
              notes: "Milk, eggs",
              updated: "2026-02-13T10:00:00.000Z",
            },
            {
              id: "task_mock_2",
              title: "Call dentist",
              status: "needsAction",
              updated: "2026-02-13T08:00:00.000Z",
            },
            {
              id: "task_mock_3",
              title: "Old completed task",
              status: "completed",
              due: "2026-02-10T00:00:00.000Z",
              updated: "2026-02-10T12:00:00.000Z",
            },
          ],
        },
      }),
      get: async (params: any) => ({
        data: {
          id: params.task,
          title: "Mock Task",
          status: "needsAction",
          due: "2026-02-15T00:00:00.000Z",
          notes: "Mock notes",
          updated: "2026-02-13T10:00:00.000Z",
        },
      }),
      insert: async (params: any) => {
        const id = nextId("task");
        return {
          data: {
            id,
            title: params.requestBody?.title,
            status: "needsAction",
            due: params.requestBody?.due,
          },
        };
      },
      patch: async (params: any) => ({
        data: {
          id: params.task,
          title: params.requestBody?.title ?? "Mock Task",
          status: params.requestBody?.status ?? "needsAction",
          due: params.requestBody?.due ?? "2026-02-15T00:00:00.000Z",
        },
      }),
      delete: async () => {
        // void
      },
    },
  };
}

/** Reset the ID counter between test runs */
export function resetMockState(): void {
  insertCounter = 0;
}
