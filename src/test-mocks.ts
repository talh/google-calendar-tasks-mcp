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

export function createMockGmailClient() {
  return {
    users: {
      messages: {
        list: async (params: any) => ({
          data: {
            messages: [
              { id: "msg_mock_1", threadId: "thread_mock_1" },
              { id: "msg_mock_2", threadId: "thread_mock_2" },
              { id: "msg_mock_3", threadId: "thread_mock_3" },
            ],
            resultSizeEstimate: 3,
          },
        }),
        get: async (params: any) => ({
          data: {
            id: params.id ?? "msg_mock_1",
            threadId: "thread_mock_1",
            labelIds: ["INBOX", "UNREAD", "CATEGORY_UPDATES"],
            snippet: "Your order has been shipped and is on its way...",
            payload: {
              headers: [
                { name: "From", value: "orders@temu.com" },
                { name: "To", value: "tal@example.com" },
                { name: "Subject", value: "Your Temu order has shipped!" },
                { name: "Date", value: "Thu, 19 Feb 2026 08:30:00 +0000" },
                { name: "Message-ID", value: "<abc123@mail.temu.com>" },
                { name: "In-Reply-To", value: "" },
                { name: "List-Unsubscribe", value: "<mailto:unsub@temu.com>" },
              ],
              mimeType: "multipart/alternative",
              parts: [
                {
                  mimeType: "text/plain",
                  body: {
                    data: Buffer.from(
                      "Dear customer, your order #PO2026-789456 has been shipped. " +
                      "Tracking number: IL123456789CN. Expected delivery: Feb 22, 2026.",
                    ).toString("base64url"),
                  },
                },
                {
                  mimeType: "text/html",
                  body: {
                    data: Buffer.from(
                      "<html><body><p>Dear customer, your order has been shipped.</p></body></html>",
                    ).toString("base64url"),
                  },
                },
              ],
            },
            internalDate: "1740991800000",
          },
        }),
        modify: async (params: any) => ({
          data: {
            id: params.id ?? "msg_mock_1",
            threadId: "thread_mock_1",
            labelIds: (() => {
              let labels = ["INBOX", "UNREAD", "CATEGORY_UPDATES"];
              if (params.requestBody?.removeLabelIds) {
                labels = labels.filter(
                  (l: string) => !params.requestBody.removeLabelIds.includes(l),
                );
              }
              if (params.requestBody?.addLabelIds) {
                labels.push(...params.requestBody.addLabelIds);
              }
              return labels;
            })(),
          },
        }),
        send: async (params: any) => {
          const id = nextId("msg");
          return {
            data: {
              id,
              threadId: params.requestBody?.threadId ?? nextId("thread"),
              labelIds: ["SENT"],
            },
          };
        },
        attachments: {
          get: async (params: any) => ({
            data: {
              data: Buffer.from("mock PDF content for testing").toString("base64url"),
              size: 28,
            },
          }),
        },
      },
      labels: {
        list: async () => ({
          data: {
            labels: [
              { id: "INBOX", name: "INBOX", type: "system" },
              { id: "SENT", name: "SENT", type: "system" },
              { id: "TRASH", name: "TRASH", type: "system" },
              { id: "UNREAD", name: "UNREAD", type: "system" },
              { id: "CATEGORY_UPDATES", name: "CATEGORY_UPDATES", type: "system" },
              { id: "Label_100", name: "DPA/Expense", type: "user" },
              { id: "Label_101", name: "DPA/Content-Scout", type: "user" },
              { id: "Label_102", name: "DPA/Processed", type: "user" },
            ],
          },
        }),
        create: async (params: any) => {
          const id = nextId("Label");
          return {
            data: {
              id,
              name: params.requestBody?.name ?? "DPA/Test",
              type: "user",
              labelListVisibility: params.requestBody?.labelListVisibility ?? "labelShow",
            },
          };
        },
      },
    },
  };
}

/** Reset the ID counter between test runs */
export function resetMockState(): void {
  insertCounter = 0;
}
