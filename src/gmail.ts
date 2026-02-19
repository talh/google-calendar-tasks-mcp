import type { GuardrailContext } from "./guardrails.js";
import type { AuditLogger } from "./audit.js";
import { successResult, errorResult, type ToolResult } from "./types.js";
import { GuardrailError, apiError } from "./errors.js";

// ============================================================
// Types
// ============================================================

/** The subset of google.gmail("v1") we actually use */
export interface GmailApi {
  users: {
    messages: {
      list: (params: any) => Promise<{ data: any }>;
      get: (params: any) => Promise<{ data: any }>;
      modify: (params: any) => Promise<{ data: any }>;
      send: (params: any) => Promise<{ data: any }>;
      attachments: {
        get: (params: any) => Promise<{ data: any }>;
      };
    };
    labels: {
      list: (params?: any) => Promise<{ data: any }>;
      create: (params: any) => Promise<{ data: any }>;
    };
  };
}

export interface ListMessagesParams {
  query?: string;
  labelIds?: string[];
  maxResults?: number;
}

export interface GetMessageParams {
  messageId: string;
  format?: "full" | "metadata" | "minimal";
}

export interface GetAttachmentParams {
  messageId: string;
  attachmentId: string;
}

export interface ModifyMessageParams {
  messageId: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

export interface ListLabelsParams {
  // no parameters
}

export interface CreateLabelParams {
  name: string;
  labelListVisibility?: "labelShow" | "labelShowIfUnread" | "labelHide";
}

export interface SendMessageParams {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  threadId?: string;
  requireApproval: true;
}

// ============================================================
// Error handling wrapper (same pattern as calendar.ts / tasks.ts)
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
    console.error("[mcp] Unexpected Gmail error:", err);
    return errorResult({
      error: true,
      code: "API_ERROR",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

// ============================================================
// Body extraction helpers
// ============================================================

function decodeBase64Url(encoded: string): string {
  // Gmail API uses URL-safe base64 (RFC 4648 §5)
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface BodyExtraction {
  body: string;
  bodyHtml?: string;
}

function extractBody(payload: any): BodyExtraction {
  // Case 1: Simple body (no parts)
  if (payload.body?.data && !payload.parts) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/plain") {
      return { body: decoded };
    }
    if (payload.mimeType === "text/html") {
      return { body: stripHtmlTags(decoded), bodyHtml: decoded };
    }
    return { body: decoded };
  }

  // Case 2: Has parts (multipart)
  if (payload.parts) {
    let plainText: string | undefined;
    let htmlText: string | undefined;
    const attachments: any[] = [];

    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        plainText = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && part.body?.data) {
        htmlText = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "multipart/alternative" && part.parts) {
        // Nested multipart/alternative
        for (const subPart of part.parts) {
          if (subPart.mimeType === "text/plain" && subPart.body?.data) {
            plainText = decodeBase64Url(subPart.body.data);
          } else if (subPart.mimeType === "text/html" && subPart.body?.data) {
            htmlText = decodeBase64Url(subPart.body.data);
          }
        }
      }
    }

    // Prefer plain text over HTML
    if (plainText) {
      return { body: plainText, bodyHtml: htmlText };
    }
    if (htmlText) {
      return { body: stripHtmlTags(htmlText), bodyHtml: htmlText };
    }
  }

  return { body: "" };
}

function extractAttachments(payload: any): any[] {
  const attachments: any[] = [];

  function walkParts(parts: any[]) {
    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size ?? 0,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) {
        walkParts(part.parts);
      }
    }
  }

  if (payload.parts) {
    walkParts(payload.parts);
  }
  return attachments;
}

function getHeader(headers: any[], name: string): string {
  const header = headers?.find(
    (h: any) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? "";
}

function parseEmailDate(dateStr: string): string {
  try {
    return new Date(dateStr).toISOString();
  } catch {
    return dateStr;
  }
}

// ============================================================
// Tool handlers
// ============================================================

export async function listMessages(
  params: ListMessagesParams,
  api: GmailApi,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const maxResults = params.maxResults ?? 20;

    const apiParams: any = {
      userId: "me",
      maxResults,
    };
    if (params.query) apiParams.q = params.query;
    if (params.labelIds) apiParams.labelIds = params.labelIds;

    const listResp = await api.users.messages.list(apiParams);
    const messageStubs = listResp.data.messages ?? [];
    const resultSizeEstimate = listResp.data.resultSizeEstimate ?? 0;

    // Fetch metadata for each message (batch)
    const messages = await Promise.all(
      messageStubs.slice(0, maxResults).map(async (stub: any) => {
        const msgResp = await api.users.messages.get({
          userId: "me",
          id: stub.id,
          format: "metadata",
          metadataHeaders: ["From", "To", "Subject", "Date"],
        });
        const msg = msgResp.data;
        const headers = msg.payload?.headers ?? [];
        return {
          id: msg.id,
          threadId: msg.threadId,
          snippet: msg.snippet ?? "",
          from: getHeader(headers, "From"),
          to: getHeader(headers, "To"),
          subject: getHeader(headers, "Subject"),
          date: parseEmailDate(getHeader(headers, "Date")),
          labelIds: msg.labelIds ?? [],
        };
      }),
    );

    return successResult({ messages, resultSizeEstimate });
  });
}

export async function getMessage(
  params: GetMessageParams,
  api: GmailApi,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const format = params.format ?? "full";

    const resp = await api.users.messages.get({
      userId: "me",
      id: params.messageId,
      format,
    });

    const msg = resp.data;
    const headers = msg.payload?.headers ?? [];

    const result: any = {
      id: msg.id,
      threadId: msg.threadId,
      from: getHeader(headers, "From"),
      to: getHeader(headers, "To"),
      subject: getHeader(headers, "Subject"),
      date: parseEmailDate(getHeader(headers, "Date")),
      labelIds: msg.labelIds ?? [],
    };

    if (format === "full") {
      const bodyResult = extractBody(msg.payload);
      result.body = bodyResult.body;
      if (bodyResult.bodyHtml) {
        result.bodyHtml = bodyResult.bodyHtml;
      }
      result.attachments = extractAttachments(msg.payload);
    }

    // Include useful headers
    result.headers = {
      "List-Unsubscribe": getHeader(headers, "List-Unsubscribe"),
      "Message-ID": getHeader(headers, "Message-ID"),
      "In-Reply-To": getHeader(headers, "In-Reply-To"),
    };

    return successResult(result);
  });
}

export async function getAttachment(
  params: GetAttachmentParams,
  api: GmailApi,
  guardrails: GuardrailContext,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    // First get the message to find attachment metadata
    const msgResp = await api.users.messages.get({
      userId: "me",
      id: params.messageId,
      format: "full",
    });

    // Find the attachment part to get its mimeType and filename
    let mimeType = "application/octet-stream";
    let filename = "attachment";
    let partSize = 0;

    function findPart(parts: any[]): void {
      for (const part of parts) {
        if (part.body?.attachmentId === params.attachmentId) {
          mimeType = part.mimeType ?? "application/octet-stream";
          filename = part.filename ?? "attachment";
          partSize = part.body.size ?? 0;
          return;
        }
        if (part.parts) findPart(part.parts);
      }
    }

    if (msgResp.data.payload?.parts) {
      findPart(msgResp.data.payload.parts);
    }

    // Guardrail checks
    guardrails.checkAttachmentType(mimeType);
    guardrails.checkAttachmentSize(partSize);

    // Fetch the attachment
    const attResp = await api.users.messages.attachments.get({
      userId: "me",
      messageId: params.messageId,
      id: params.attachmentId,
    });

    return successResult({
      data: attResp.data.data,
      mimeType,
      filename,
      size: attResp.data.size ?? partSize,
    });
  });
}

export async function modifyMessage(
  params: ModifyMessageParams,
  api: GmailApi,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkGmailModifyLimit(1);

    const requestBody: any = {};
    if (params.addLabelIds) requestBody.addLabelIds = params.addLabelIds;
    if (params.removeLabelIds) requestBody.removeLabelIds = params.removeLabelIds;

    const resp = await api.users.messages.modify({
      userId: "me",
      id: params.messageId,
      requestBody,
    });

    guardrails.incrementGmailModifyCounter(1);

    // Build a descriptive title for the audit log
    const actions: string[] = [];
    if (params.removeLabelIds?.includes("INBOX")) actions.push("Archive");
    if (params.addLabelIds?.includes("TRASH")) actions.push("Trash");
    if (params.addLabelIds?.filter((l) => l !== "TRASH").length) {
      actions.push(`Label: ${params.addLabelIds.filter((l) => l !== "TRASH").join(", ")}`);
    }
    if (params.removeLabelIds?.filter((l) => l !== "INBOX").length) {
      actions.push(`Unlabel: ${params.removeLabelIds.filter((l) => l !== "INBOX").join(", ")}`);
    }
    const title = actions.join(" + ") || "Modify message";

    try {
      await audit.log({
        operation: "update",
        service: "gmail",
        title,
        googleId: `msg_${params.messageId}`,
        changes: {
          addLabelIds: params.addLabelIds ?? [],
          removeLabelIds: params.removeLabelIds ?? [],
        },
        timestamp: new Date().toISOString(),
        source: "mcp",
      });
    } catch (auditErr) {
      console.error("[mcp] Audit log failed (non-fatal):", auditErr);
    }

    return successResult({
      id: resp.data.id,
      labelIds: resp.data.labelIds ?? [],
    });
  });
}

export async function listLabels(
  api: GmailApi,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    const resp = await api.users.labels.list({ userId: "me" });
    const labels = (resp.data.labels ?? []).map((label: any) => ({
      id: label.id,
      name: label.name,
      type: label.type ?? "user",
    }));
    return successResult({ labels });
  });
}

export async function createLabel(
  params: CreateLabelParams,
  api: GmailApi,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkWriteLimit(1);

    const resp = await api.users.labels.create({
      userId: "me",
      requestBody: {
        name: params.name,
        labelListVisibility: params.labelListVisibility ?? "labelShow",
        messageListVisibility: "show",
      },
    });

    guardrails.incrementWriteCounter(1);

    try {
      await audit.log({
        operation: "create",
        service: "gmail",
        title: `Label: ${params.name}`,
        googleId: resp.data.id,
        timestamp: new Date().toISOString(),
        source: "mcp",
      });
    } catch (auditErr) {
      console.error("[mcp] Audit log failed (non-fatal):", auditErr);
    }

    return successResult({
      id: resp.data.id,
      name: resp.data.name,
    });
  });
}

export async function sendMessage(
  params: SendMessageParams,
  api: GmailApi,
  guardrails: GuardrailContext,
  audit: AuditLogger,
): Promise<ToolResult> {
  return withErrorHandling(async () => {
    guardrails.checkGmailSendLimit(1);

    // Build RFC 2822 message
    const messageParts: string[] = [
      `To: ${params.to}`,
      `Subject: ${params.subject}`,
      `Content-Type: text/plain; charset="UTF-8"`,
    ];

    if (params.inReplyTo) {
      messageParts.push(`In-Reply-To: ${params.inReplyTo}`);
      messageParts.push(`References: ${params.inReplyTo}`);
    }

    messageParts.push(""); // blank line between headers and body
    messageParts.push(params.body);

    const rawMessage = messageParts.join("\r\n");
    // Encode as base64url for Gmail API
    const encoded = Buffer.from(rawMessage)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const requestBody: any = { raw: encoded };
    if (params.threadId) {
      requestBody.threadId = params.threadId;
    }

    const resp = await api.users.messages.send({
      userId: "me",
      requestBody,
    });

    guardrails.incrementGmailSendCounter(1);

    try {
      await audit.log({
        operation: "create",
        service: "gmail",
        title: `Send: ${params.subject}`,
        googleId: `msg_${resp.data.id}`,
        changes: {
          to: params.to,
          subject: params.subject,
        },
        timestamp: new Date().toISOString(),
        source: "mcp",
      });
    } catch (auditErr) {
      console.error("[mcp] Audit log failed (non-fatal):", auditErr);
    }

    return successResult({
      id: resp.data.id,
      threadId: resp.data.threadId,
    });
  });
}
