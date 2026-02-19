import { describe, it, expect, beforeEach } from "vitest";
import {
  listMessages,
  getMessage,
  getAttachment,
  modifyMessage,
  listLabels,
  createLabel,
  sendMessage,
} from "../../src/gmail.js";
import { createMockGmailClient, resetMockState } from "../../src/test-mocks.js";
import { GuardrailContext } from "../../src/guardrails.js";
import { createAuditLogger } from "../../src/audit.js";
import type { GmailApi } from "../../src/gmail.js";
import type { AuditLogger } from "../../src/audit.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe("gmail", () => {
  let api: GmailApi;
  let guardrails: GuardrailContext;
  let audit: AuditLogger;
  let auditDir: string;

  beforeEach(() => {
    resetMockState();
    api = createMockGmailClient() as GmailApi;
    guardrails = new GuardrailContext({
      dailyWriteLimit: 50,
      pastEventProtectionDays: 7,
      protectedCalendars: [],
      protectedTaskLists: [],
      allowRecurringSeriesDelete: false,
      gmail: {
        dailySendLimit: 5,
        dailyModifyLimit: 100,
        maxAttachmentSizeMB: 10,
        blockedAttachmentTypes: [
          "application/x-executable",
          "application/x-msdos-program",
          "application/x-msdownload",
          "application/x-dosexec",
        ],
        requireApprovalForSend: true,
      },
    });
    guardrails.resetForTesting();

    // Create a temp dir for audit logs
    auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "gmail-audit-"));
    audit = createAuditLogger(auditDir);
  });

  // ============================================================
  // gmail_list_messages
  // ============================================================

  describe("listMessages", () => {
    it("returns a list of messages with correct fields", async () => {
      const result = await listMessages({}, api);
      const data = parseResult(result);
      expect(data.messages).toBeDefined();
      expect(data.messages.length).toBe(3);
      expect(data.resultSizeEstimate).toBe(3);
      // Each message has the expected fields
      const msg = data.messages[0];
      expect(msg.id).toBeDefined();
      expect(msg.threadId).toBeDefined();
      expect(msg.from).toBeDefined();
      expect(msg.subject).toBeDefined();
      expect(msg.date).toBeDefined();
      expect(msg.labelIds).toBeDefined();
    });

    it("respects maxResults parameter", async () => {
      const result = await listMessages({ maxResults: 2 }, api);
      const data = parseResult(result);
      // Mock returns 3, but we capped at 2
      expect(data.messages.length).toBeLessThanOrEqual(2);
    });

    it("passes query parameter through", async () => {
      // Just verify it doesn't throw
      const result = await listMessages({ query: "is:unread" }, api);
      const data = parseResult(result);
      expect(data.messages).toBeDefined();
    });

    it("passes labelIds parameter through", async () => {
      const result = await listMessages({ labelIds: ["INBOX", "UNREAD"] }, api);
      const data = parseResult(result);
      expect(data.messages).toBeDefined();
    });

    it("does not invoke guardrails (read-only)", async () => {
      // Verify no errors even with fresh guardrails
      const result = await listMessages({}, api);
      expect(result.isError).toBeUndefined();
    });
  });

  // ============================================================
  // gmail_get_message
  // ============================================================

  describe("getMessage", () => {
    it("returns full message with body and headers", async () => {
      const result = await getMessage({ messageId: "msg_mock_1" }, api);
      const data = parseResult(result);
      expect(data.id).toBe("msg_mock_1");
      expect(data.threadId).toBe("thread_mock_1");
      expect(data.from).toBe("orders@temu.com");
      expect(data.subject).toBe("Your Temu order has shipped!");
      expect(data.body).toContain("order #PO2026-789456");
      expect(data.labelIds).toContain("INBOX");
    });

    it("extracts plain text body preferring text/plain over text/html", async () => {
      const result = await getMessage({ messageId: "msg_mock_1" }, api);
      const data = parseResult(result);
      // Body should be the plain text content, not HTML
      expect(data.body).toContain("Tracking number: IL123456789CN");
      expect(data.body).not.toContain("<html>");
    });

    it("includes useful headers", async () => {
      const result = await getMessage({ messageId: "msg_mock_1" }, api);
      const data = parseResult(result);
      expect(data.headers).toBeDefined();
      expect(data.headers["Message-ID"]).toBe("<abc123@mail.temu.com>");
      expect(data.headers["List-Unsubscribe"]).toBe("<mailto:unsub@temu.com>");
    });

    it("does not write audit entries (read-only)", async () => {
      await getMessage({ messageId: "msg_mock_1" }, api);
      // Check audit dir is empty
      const files = fs.readdirSync(auditDir);
      expect(files.length).toBe(0);
    });
  });

  // ============================================================
  // gmail_list_labels
  // ============================================================

  describe("listLabels", () => {
    it("returns both system and user labels", async () => {
      const result = await listLabels(api);
      const data = parseResult(result);
      expect(data.labels).toBeDefined();
      expect(data.labels.length).toBeGreaterThan(0);

      const systemLabel = data.labels.find((l: any) => l.id === "INBOX");
      expect(systemLabel).toBeDefined();
      expect(systemLabel.type).toBe("system");

      const userLabel = data.labels.find((l: any) => l.name === "DPA/Expense");
      expect(userLabel).toBeDefined();
      expect(userLabel.type).toBe("user");
    });
  });

  // ============================================================
  // gmail_modify_message
  // ============================================================

  describe("modifyMessage", () => {
    it("archives a message (remove INBOX label)", async () => {
      const result = await modifyMessage(
        { messageId: "msg_mock_1", removeLabelIds: ["INBOX"] },
        api,
        guardrails,
        audit,
      );
      const data = parseResult(result);
      expect(data.id).toBe("msg_mock_1");
      expect(data.labelIds).not.toContain("INBOX");
    });

    it("trashes a message (add TRASH label)", async () => {
      const result = await modifyMessage(
        { messageId: "msg_mock_1", addLabelIds: ["TRASH"] },
        api,
        guardrails,
        audit,
      );
      const data = parseResult(result);
      expect(data.labelIds).toContain("TRASH");
    });

    it("applies a label", async () => {
      const result = await modifyMessage(
        { messageId: "msg_mock_1", addLabelIds: ["Label_100"] },
        api,
        guardrails,
        audit,
      );
      const data = parseResult(result);
      expect(data.labelIds).toContain("Label_100");
    });

    it("combined: archive + label", async () => {
      const result = await modifyMessage(
        { messageId: "msg_mock_1", addLabelIds: ["Label_100"], removeLabelIds: ["INBOX"] },
        api,
        guardrails,
        audit,
      );
      const data = parseResult(result);
      expect(data.labelIds).toContain("Label_100");
      expect(data.labelIds).not.toContain("INBOX");
    });

    it("increments Gmail modify counter", async () => {
      await modifyMessage(
        { messageId: "msg_mock_1", removeLabelIds: ["INBOX"] },
        api,
        guardrails,
        audit,
      );
      // Can't directly read counter, but running 100 more should fail
      for (let i = 0; i < 99; i++) {
        await modifyMessage(
          { messageId: "msg_mock_1", removeLabelIds: ["INBOX"] },
          api,
          guardrails,
          audit,
        );
      }
      // 101st should fail
      const result = await modifyMessage(
        { messageId: "msg_mock_1", removeLabelIds: ["INBOX"] },
        api,
        guardrails,
        audit,
      );
      const data = parseResult(result);
      expect(data.error).toBe(true);
      expect(data.code).toBe("DAILY_LIMIT_REACHED");
    });

    it("writes audit entry with correct fields", async () => {
      await modifyMessage(
        { messageId: "msg_mock_1", removeLabelIds: ["INBOX"], addLabelIds: ["Label_100"] },
        api,
        guardrails,
        audit,
      );

      const files = fs.readdirSync(auditDir);
      expect(files.length).toBe(1);

      const auditFile = JSON.parse(
        fs.readFileSync(path.join(auditDir, files[0]), "utf-8"),
      );
      expect(auditFile.entries.length).toBe(1);

      const entry = auditFile.entries[0];
      expect(entry.operation).toBe("update");
      expect(entry.service).toBe("gmail");
      expect(entry.changes).toEqual({
        addLabelIds: ["Label_100"],
        removeLabelIds: ["INBOX"],
      });
    });
  });

  // ============================================================
  // gmail_create_label
  // ============================================================

  describe("createLabel", () => {
    it("creates a label with correct name", async () => {
      const result = await createLabel(
        { name: "DPA/Test" },
        api,
        guardrails,
        audit,
      );
      const data = parseResult(result);
      expect(data.id).toBeDefined();
      expect(data.name).toBe("DPA/Test");
    });

    it("uses shared write limit (calendar/tasks)", async () => {
      // createLabel uses checkWriteLimit, not checkGmailModifyLimit
      const result = await createLabel(
        { name: "DPA/Test" },
        api,
        guardrails,
        audit,
      );
      expect(result.isError).toBeUndefined();
    });

    it("writes audit entry", async () => {
      await createLabel(
        { name: "DPA/NewLabel" },
        api,
        guardrails,
        audit,
      );

      const files = fs.readdirSync(auditDir);
      expect(files.length).toBe(1);

      const auditFile = JSON.parse(
        fs.readFileSync(path.join(auditDir, files[0]), "utf-8"),
      );
      const entry = auditFile.entries[0];
      expect(entry.operation).toBe("create");
      expect(entry.service).toBe("gmail");
      expect(entry.title).toContain("DPA/NewLabel");
    });
  });

  // ============================================================
  // gmail_send_message
  // ============================================================

  describe("sendMessage", () => {
    it("sends a message with requireApproval: true", async () => {
      const result = await sendMessage(
        {
          to: "test@example.com",
          subject: "Test subject",
          body: "Test body",
          requireApproval: true,
        },
        api,
        guardrails,
        audit,
      );
      const data = parseResult(result);
      expect(data.id).toBeDefined();
      expect(data.threadId).toBeDefined();
    });

    it("increments send counter and respects limit", async () => {
      // Send 5 (the daily limit)
      for (let i = 0; i < 5; i++) {
        const result = await sendMessage(
          {
            to: "test@example.com",
            subject: `Test ${i}`,
            body: "body",
            requireApproval: true,
          },
          api,
          guardrails,
          audit,
        );
        expect(result.isError).toBeUndefined();
      }

      // 6th should fail
      const result = await sendMessage(
        {
          to: "test@example.com",
          subject: "Test 6",
          body: "body",
          requireApproval: true,
        },
        api,
        guardrails,
        audit,
      );
      const data = parseResult(result);
      expect(data.error).toBe(true);
      expect(data.code).toBe("SEND_LIMIT_REACHED");
    });

    it("writes audit entry with recipient and subject", async () => {
      await sendMessage(
        {
          to: "recipient@example.com",
          subject: "Important message",
          body: "body",
          requireApproval: true,
        },
        api,
        guardrails,
        audit,
      );

      const files = fs.readdirSync(auditDir);
      const auditFile = JSON.parse(
        fs.readFileSync(path.join(auditDir, files[0]), "utf-8"),
      );
      const entry = auditFile.entries[0];
      expect(entry.operation).toBe("create");
      expect(entry.service).toBe("gmail");
      expect(entry.changes?.to).toBe("recipient@example.com");
      expect(entry.changes?.subject).toBe("Important message");
    });

    it("supports threaded replies with inReplyTo and threadId", async () => {
      const result = await sendMessage(
        {
          to: "test@example.com",
          subject: "Re: Test thread",
          body: "reply body",
          inReplyTo: "<original@mail.example.com>",
          threadId: "thread_123",
          requireApproval: true,
        },
        api,
        guardrails,
        audit,
      );
      const data = parseResult(result);
      expect(data.id).toBeDefined();
    });
  });

  // ============================================================
  // gmail_get_attachment
  // ============================================================

  describe("getAttachment", () => {
    it("returns attachment data", async () => {
      // The mock getMessage doesn't include attachments with IDs,
      // but the attachment mock returns data regardless
      const result = await getAttachment(
        { messageId: "msg_mock_1", attachmentId: "att_001" },
        api,
        guardrails,
      );
      const data = parseResult(result);
      expect(data.data).toBeDefined();
    });

    it("blocks executable attachments", async () => {
      // Create a custom mock that returns an executable type
      const customApi = createMockGmailClient() as GmailApi;
      const origGet = customApi.users.messages.get;
      customApi.users.messages.get = async (params: any) => {
        const resp = await origGet(params);
        resp.data.payload.parts = [
          {
            mimeType: "application/x-executable",
            filename: "malware.exe",
            body: { attachmentId: "att_bad", size: 1000 },
          },
        ];
        return resp;
      };

      const result = await getAttachment(
        { messageId: "msg_mock_1", attachmentId: "att_bad" },
        customApi,
        guardrails,
      );
      const data = parseResult(result);
      expect(data.error).toBe(true);
      expect(data.code).toBe("BLOCKED_ATTACHMENT_TYPE");
    });

    it("blocks oversized attachments", async () => {
      // Create a custom mock with large attachment
      const customApi = createMockGmailClient() as GmailApi;
      const origGet = customApi.users.messages.get;
      customApi.users.messages.get = async (params: any) => {
        const resp = await origGet(params);
        resp.data.payload.parts = [
          {
            mimeType: "application/pdf",
            filename: "huge.pdf",
            body: { attachmentId: "att_big", size: 20 * 1024 * 1024 }, // 20MB
          },
        ];
        return resp;
      };

      const result = await getAttachment(
        { messageId: "msg_mock_1", attachmentId: "att_big" },
        customApi,
        guardrails,
      );
      const data = parseResult(result);
      expect(data.error).toBe(true);
      expect(data.code).toBe("ATTACHMENT_TOO_LARGE");
    });

    it("allows PDF attachments under size limit", async () => {
      const customApi = createMockGmailClient() as GmailApi;
      const origGet = customApi.users.messages.get;
      customApi.users.messages.get = async (params: any) => {
        const resp = await origGet(params);
        resp.data.payload.parts = [
          {
            mimeType: "application/pdf",
            filename: "invoice.pdf",
            body: { attachmentId: "att_pdf", size: 5 * 1024 * 1024 }, // 5MB
          },
        ];
        return resp;
      };

      const result = await getAttachment(
        { messageId: "msg_mock_1", attachmentId: "att_pdf" },
        customApi,
        guardrails,
      );
      const data = parseResult(result);
      expect(data.error).toBeUndefined();
      expect(data.data).toBeDefined();
    });

    it("does not write audit entries (read-only operation)", async () => {
      await getAttachment(
        { messageId: "msg_mock_1", attachmentId: "att_001" },
        api,
        guardrails,
      );
      const files = fs.readdirSync(auditDir);
      expect(files.length).toBe(0);
    });
  });

  // ============================================================
  // Guardrails extension tests
  // ============================================================

  describe("guardrails - gmail specific", () => {
    it("checkGmailSendLimit throws at limit", () => {
      for (let i = 0; i < 5; i++) {
        guardrails.checkGmailSendLimit(1);
        guardrails.incrementGmailSendCounter(1);
      }
      expect(() => guardrails.checkGmailSendLimit(1)).toThrow();
    });

    it("checkGmailModifyLimit throws at limit", () => {
      for (let i = 0; i < 100; i++) {
        guardrails.checkGmailModifyLimit(1);
        guardrails.incrementGmailModifyCounter(1);
      }
      expect(() => guardrails.checkGmailModifyLimit(1)).toThrow();
    });

    it("checkAttachmentSize passes for small files", () => {
      expect(() => guardrails.checkAttachmentSize(5 * 1024 * 1024)).not.toThrow();
    });

    it("checkAttachmentSize throws for large files", () => {
      expect(() => guardrails.checkAttachmentSize(15 * 1024 * 1024)).toThrow();
    });

    it("checkAttachmentType passes for PDF", () => {
      expect(() => guardrails.checkAttachmentType("application/pdf")).not.toThrow();
    });

    it("checkAttachmentType passes for JPEG", () => {
      expect(() => guardrails.checkAttachmentType("image/jpeg")).not.toThrow();
    });

    it("checkAttachmentType throws for executable", () => {
      expect(() => guardrails.checkAttachmentType("application/x-executable")).toThrow();
    });

    it("counters reset on date change", () => {
      // Fill up send limit
      for (let i = 0; i < 5; i++) {
        guardrails.incrementGmailSendCounter(1);
      }
      expect(() => guardrails.checkGmailSendLimit(1)).toThrow();

      // Simulate date change
      guardrails.setDateForTesting("2020-01-01");
      // Should not throw — counter was reset
      expect(() => guardrails.checkGmailSendLimit(1)).not.toThrow();
    });

    it("Gmail guardrails defaults apply when no gmail config", () => {
      const minimalGuardrails = new GuardrailContext({
        dailyWriteLimit: 50,
        pastEventProtectionDays: 7,
        protectedCalendars: [],
        protectedTaskLists: [],
        allowRecurringSeriesDelete: false,
        // No gmail section — defaults should apply
      });

      // Default send limit is 5
      for (let i = 0; i < 5; i++) {
        minimalGuardrails.checkGmailSendLimit(1);
        minimalGuardrails.incrementGmailSendCounter(1);
      }
      expect(() => minimalGuardrails.checkGmailSendLimit(1)).toThrow();
    });

    it("existing checkWriteLimit is unaffected", () => {
      // Calendar/tasks writes should still work
      expect(() => guardrails.checkWriteLimit(1)).not.toThrow();
      guardrails.incrementWriteCounter(1);
      expect(guardrails.getWriteCount()).toBe(1);
    });
  });
});
