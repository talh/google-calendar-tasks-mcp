import fs from "node:fs";
import { GuardrailError } from "./errors.js";

export interface GmailGuardrailConfig {
  dailySendLimit: number;
  dailyModifyLimit: number;
  maxAttachmentSizeMB: number;
  blockedAttachmentTypes: string[];
  requireApprovalForSend: boolean;
}

export interface GuardrailConfig {
  dailyWriteLimit: number;
  pastEventProtectionDays: number;
  protectedCalendars: string[];
  protectedTaskLists: string[];
  allowRecurringSeriesDelete: boolean;
  gmail?: GmailGuardrailConfig;
}

export class GuardrailContext {
  private config: GuardrailConfig;
  private writeCount: number = 0;
  private gmailSendCount: number = 0;
  private gmailModifyCount: number = 0;
  private writeCountDate: string;

  constructor(config: GuardrailConfig) {
    this.config = config;
    this.writeCountDate = this.todayUTC();
  }

  private todayUTC(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private ensureDateCurrent(): void {
    const today = this.todayUTC();
    if (this.writeCountDate !== today) {
      this.writeCount = 0;
      this.gmailSendCount = 0;
      this.gmailModifyCount = 0;
      this.writeCountDate = today;
    }
  }

  checkWriteLimit(cost: number = 1): void {
    this.ensureDateCurrent();
    if (this.writeCount + cost > this.config.dailyWriteLimit) {
      throw new GuardrailError(
        "DAILY_LIMIT_REACHED",
        `Daily write limit reached (${this.writeCount}/${this.config.dailyWriteLimit}). No more write operations allowed today.`,
      );
    }
  }

  checkProtectedCalendar(calendarId: string): void {
    if (this.config.protectedCalendars.includes(calendarId)) {
      throw new GuardrailError(
        "PROTECTED_RESOURCE",
        `Calendar '${calendarId}' is protected and cannot be modified via MCP.`,
      );
    }
  }

  checkProtectedTaskList(taskListId: string): void {
    if (this.config.protectedTaskLists.includes(taskListId)) {
      throw new GuardrailError(
        "PROTECTED_RESOURCE",
        `Task list '${taskListId}' is protected and cannot be modified via MCP.`,
      );
    }
  }

  checkPastEventProtection(eventEndTime: string): void {
    const endDate = new Date(eventEndTime);
    const now = new Date();
    const diffMs = now.getTime() - endDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays >= this.config.pastEventProtectionDays) {
      throw new GuardrailError(
        "PAST_EVENT_PROTECTED",
        `Cannot modify event that ended more than ${this.config.pastEventProtectionDays} days ago.`,
      );
    }
  }

  checkRecurringSeriesDelete(event: {
    recurrence?: string[];
    recurringEventId?: string;
  }): void {
    if (!this.config.allowRecurringSeriesDelete) {
      // A series master has recurrence rules but no recurringEventId.
      // A single instance has recurringEventId pointing to its master.
      const isSeriesMaster =
        event.recurrence &&
        event.recurrence.length > 0 &&
        !event.recurringEventId;

      if (isSeriesMaster) {
        throw new GuardrailError(
          "RECURRING_SERIES_BLOCKED",
          "Cannot delete a recurring event series. Only individual instances can be deleted.",
        );
      }
    }
  }

  checkGmailSendLimit(cost: number = 1): void {
    this.ensureDateCurrent();
    const limit = this.config.gmail?.dailySendLimit ?? 5;
    if (this.gmailSendCount + cost > limit) {
      throw new GuardrailError(
        "SEND_LIMIT_REACHED",
        `Daily email send limit reached (${this.gmailSendCount}/${limit}). No more emails can be sent today.`,
      );
    }
  }

  checkGmailModifyLimit(cost: number = 1): void {
    this.ensureDateCurrent();
    const limit = this.config.gmail?.dailyModifyLimit ?? 100;
    if (this.gmailModifyCount + cost > limit) {
      throw new GuardrailError(
        "DAILY_LIMIT_REACHED",
        `Daily Gmail modify limit reached (${this.gmailModifyCount}/${limit}). No more label/archive/trash operations allowed today.`,
      );
    }
  }

  checkAttachmentSize(sizeBytes: number): void {
    const limitMB = this.config.gmail?.maxAttachmentSizeMB ?? 10;
    if (sizeBytes > limitMB * 1024 * 1024) {
      throw new GuardrailError(
        "ATTACHMENT_TOO_LARGE",
        `Attachment exceeds ${limitMB}MB limit.`,
      );
    }
  }

  checkAttachmentType(mimeType: string): void {
    const blocked = this.config.gmail?.blockedAttachmentTypes ?? [];
    if (blocked.includes(mimeType)) {
      throw new GuardrailError(
        "BLOCKED_ATTACHMENT_TYPE",
        `Attachment type '${mimeType}' is blocked for security.`,
      );
    }
  }

  incrementGmailSendCounter(cost: number = 1): void {
    this.ensureDateCurrent();
    this.gmailSendCount += cost;
  }

  incrementGmailModifyCounter(cost: number = 1): void {
    this.ensureDateCurrent();
    this.gmailModifyCount += cost;
  }

  incrementWriteCounter(cost: number = 1): void {
    this.ensureDateCurrent();
    this.writeCount += cost;
  }

  getWriteCount(): number {
    return this.writeCount;
  }

  getConfig(): GuardrailConfig {
    return this.config;
  }

  /** Reset state for testing purposes */
  resetForTesting(): void {
    this.writeCount = 0;
    this.gmailSendCount = 0;
    this.gmailModifyCount = 0;
    this.writeCountDate = this.todayUTC();
  }

  /** Override the internal date for testing date-change reset */
  setDateForTesting(dateStr: string): void {
    this.writeCountDate = dateStr;
  }
}

export function loadGuardrails(configPath: string): GuardrailContext {
  const raw = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as GuardrailConfig;
  return new GuardrailContext(config);
}
