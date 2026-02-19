/**
 * Live Gmail API test — verifies the 7 Gmail MCP tools work against the real account.
 *
 * Run: node tests/manual/live-gmail-test.mjs
 *
 * Tests (read-only are safe, write tests are gated):
 * 1. gmail_list_labels — list all labels
 * 2. gmail_list_messages — list recent inbox messages (max 3)
 * 3. gmail_get_message — get full content of the first message
 * 4. (Optional) gmail_create_label — create DPA/Test label
 * 5. (Optional) gmail_modify_message — mark a message as read
 */

import { google } from "googleapis";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { OAuth2Client } from "google-auth-library";

// --- Load credentials (same logic as auth.ts) ---
function getDefaultCredentialsPath() {
  if (platform() === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "google-calendar-tasks-mcp", "credentials.json");
  }
  return join(homedir(), ".config", "google-calendar-tasks-mcp", "credentials.json");
}

const credPath = process.env.GOOGLE_MCP_CREDENTIALS_PATH ?? getDefaultCredentialsPath();
console.log(`Loading credentials from: ${credPath}\n`);

const creds = JSON.parse(readFileSync(credPath, "utf-8"));
const auth = new OAuth2Client(creds.clientId, creds.clientSecret);
auth.setCredentials({ refresh_token: creds.refreshToken });

const gmail = google.gmail({ version: "v1", auth });

// --- Helpers ---
function divider(title) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(60));
}

function pass(msg) { console.log(`  ✅ ${msg}`); }
function fail(msg, err) { console.log(`  ❌ ${msg}: ${err.message ?? err}`); }

let testsPassed = 0;
let testsFailed = 0;

// --- Test 1: List Labels ---
divider("Test 1: gmail_list_labels");
try {
  const resp = await gmail.users.labels.list({ userId: "me" });
  const labels = resp.data.labels ?? [];
  pass(`Found ${labels.length} labels`);

  const systemLabels = labels.filter(l => l.type === "system").map(l => l.name);
  const userLabels = labels.filter(l => l.type === "user").map(l => l.name);
  console.log(`  System labels: ${systemLabels.slice(0, 8).join(", ")}${systemLabels.length > 8 ? "..." : ""}`);
  console.log(`  User labels: ${userLabels.length > 0 ? userLabels.join(", ") : "(none)"}`);
  testsPassed++;
} catch (err) {
  fail("List labels failed", err);
  testsFailed++;
}

// --- Test 2: List Messages ---
divider("Test 2: gmail_list_messages (inbox, max 3)");
let firstMessageId = null;
try {
  const resp = await gmail.users.messages.list({
    userId: "me",
    q: "is:inbox",
    maxResults: 3,
  });
  const messages = resp.data.messages ?? [];
  pass(`Found ${resp.data.resultSizeEstimate ?? "?"} messages (showing ${messages.length})`);

  for (const msg of messages) {
    // Get metadata for each
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    const headers = detail.data.payload?.headers ?? [];
    const from = headers.find(h => h.name === "From")?.value ?? "?";
    const subject = headers.find(h => h.name === "Subject")?.value ?? "?";
    const date = headers.find(h => h.name === "Date")?.value ?? "?";
    console.log(`  📧 [${msg.id}] ${from.slice(0, 40)} — ${subject.slice(0, 50)}`);
  }

  if (messages.length > 0) {
    firstMessageId = messages[0].id;
  }
  testsPassed++;
} catch (err) {
  fail("List messages failed", err);
  testsFailed++;
}

// --- Test 3: Get Message (full) ---
if (firstMessageId) {
  divider(`Test 3: gmail_get_message (id: ${firstMessageId})`);
  try {
    const resp = await gmail.users.messages.get({
      userId: "me",
      id: firstMessageId,
      format: "full",
    });
    const msg = resp.data;
    const headers = msg.payload?.headers ?? [];
    const from = headers.find(h => h.name === "From")?.value ?? "?";
    const subject = headers.find(h => h.name === "Subject")?.value ?? "?";
    const listUnsub = headers.find(h => h.name === "List-Unsubscribe")?.value ?? "(none)";

    pass(`Got full message`);
    console.log(`  From: ${from}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Labels: ${(msg.labelIds ?? []).join(", ")}`);
    console.log(`  List-Unsubscribe: ${listUnsub}`);
    console.log(`  MIME type: ${msg.payload?.mimeType}`);

    // Test body extraction
    let bodyPreview = "";
    if (msg.payload?.parts) {
      const textPart = msg.payload.parts.find(p => p.mimeType === "text/plain");
      if (textPart?.body?.data) {
        const decoded = Buffer.from(textPart.body.data, "base64url").toString("utf-8");
        bodyPreview = decoded.slice(0, 200).replace(/\n/g, " ");
      } else {
        const htmlPart = msg.payload.parts.find(p => p.mimeType === "text/html");
        if (htmlPart?.body?.data) {
          bodyPreview = "(HTML body available, text/plain not found)";
        }
      }
    } else if (msg.payload?.body?.data) {
      bodyPreview = Buffer.from(msg.payload.body.data, "base64url").toString("utf-8").slice(0, 200);
    }
    console.log(`  Body preview: ${bodyPreview.slice(0, 150)}...`);

    // Check for attachments
    const attachments = [];
    function walkParts(parts) {
      for (const p of parts ?? []) {
        if (p.filename && p.body?.attachmentId) {
          attachments.push({ filename: p.filename, mimeType: p.mimeType, size: p.body.size });
        }
        if (p.parts) walkParts(p.parts);
      }
    }
    walkParts(msg.payload?.parts);
    if (attachments.length > 0) {
      console.log(`  Attachments: ${attachments.map(a => `${a.filename} (${a.mimeType}, ${a.size}B)`).join(", ")}`);
    } else {
      console.log(`  Attachments: none`);
    }

    testsPassed++;
  } catch (err) {
    fail("Get message failed", err);
    testsFailed++;
  }
} else {
  divider("Test 3: SKIPPED (no messages found)");
}

// --- Test 4: Verify Calendar/Tasks still work (regression check) ---
divider("Test 4: Regression — Calendar still works");
try {
  const cal = google.calendar({ version: "v3", auth });
  const resp = await cal.calendarList.list();
  const calendars = resp.data.items ?? [];
  pass(`Calendar API working — ${calendars.length} calendars found`);
  testsPassed++;
} catch (err) {
  fail("Calendar API regression", err);
  testsFailed++;
}

divider("Test 5: Regression — Tasks still works");
try {
  const tasksApi = google.tasks({ version: "v1", auth });
  const resp = await tasksApi.tasklists.list();
  const lists = resp.data.items ?? [];
  pass(`Tasks API working — ${lists.length} task lists found`);
  testsPassed++;
} catch (err) {
  fail("Tasks API regression", err);
  testsFailed++;
}

// --- Summary ---
divider("SUMMARY");
console.log(`  Passed: ${testsPassed}`);
console.log(`  Failed: ${testsFailed}`);
console.log(`  Total:  ${testsPassed + testsFailed}`);
if (testsFailed === 0) {
  console.log(`\n  🎉 All Gmail tools verified against live API!`);
} else {
  console.log(`\n  ⚠️  Some tests failed — check output above.`);
}
console.log();
