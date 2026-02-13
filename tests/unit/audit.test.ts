import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createAuditLogger, type AuditEntry } from "../../src/audit.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mcp-audit-test-"));
}

function sampleEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    operation: "create",
    service: "calendar",
    title: "Test Event",
    googleId: "abc123",
    timestamp: "2026-02-13T14:30:00Z",
    source: "mcp",
    ...overrides,
  };
}

describe("NoOpAuditLogger", () => {
  it("log() resolves without error", async () => {
    const logger = createAuditLogger(null);
    await expect(logger.log(sampleEntry())).resolves.toBeUndefined();
  });

  it("does not create any files", async () => {
    const dir = makeTempDir();
    const logger = createAuditLogger(null);
    await logger.log(sampleEntry());
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(0);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("FileAuditLogger", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a new file with correct structure", async () => {
    const logger = createAuditLogger(tempDir);
    await logger.log(sampleEntry());

    const filePath = path.join(tempDir, "operations_2026-02.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data.month).toBe("2026-02");
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].operation).toBe("create");
    expect(data.entries[0].title).toBe("Test Event");
    expect(data.entries[0].googleId).toBe("abc123");
  });

  it("appends to existing file", async () => {
    const logger = createAuditLogger(tempDir);
    await logger.log(sampleEntry({ title: "First" }));
    await logger.log(sampleEntry({ title: "Second", operation: "update" }));

    const filePath = path.join(tempDir, "operations_2026-02.json");
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data.entries).toHaveLength(2);
    expect(data.entries[0].title).toBe("First");
    expect(data.entries[1].title).toBe("Second");
    expect(data.entries[1].operation).toBe("update");
  });

  it("creates directory if it doesn't exist", async () => {
    const nestedDir = path.join(tempDir, "nested", "dir");
    const logger = createAuditLogger(nestedDir);
    await logger.log(sampleEntry());

    const filePath = path.join(nestedDir, "operations_2026-02.json");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("handles corrupted JSON file gracefully", async () => {
    // Write garbage to the file
    const filePath = path.join(tempDir, "operations_2026-02.json");
    fs.writeFileSync(filePath, "not valid json{{{");

    const logger = createAuditLogger(tempDir);
    await logger.log(sampleEntry());

    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data.month).toBe("2026-02");
    expect(data.entries).toHaveLength(1);
  });

  it("writes entries with changes field", async () => {
    const logger = createAuditLogger(tempDir);
    await logger.log(
      sampleEntry({
        operation: "update",
        changes: { startTime: "15:00" },
      }),
    );

    const filePath = path.join(tempDir, "operations_2026-02.json");
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(data.entries[0].changes).toEqual({ startTime: "15:00" });
  });

  it("separates entries by month", async () => {
    const logger = createAuditLogger(tempDir);
    await logger.log(sampleEntry({ timestamp: "2026-02-13T10:00:00Z" }));
    await logger.log(sampleEntry({ timestamp: "2026-03-01T10:00:00Z" }));

    expect(fs.existsSync(path.join(tempDir, "operations_2026-02.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "operations_2026-03.json"))).toBe(true);

    const feb = JSON.parse(fs.readFileSync(path.join(tempDir, "operations_2026-02.json"), "utf-8"));
    const mar = JSON.parse(fs.readFileSync(path.join(tempDir, "operations_2026-03.json"), "utf-8"));
    expect(feb.entries).toHaveLength(1);
    expect(mar.entries).toHaveLength(1);
  });
});
