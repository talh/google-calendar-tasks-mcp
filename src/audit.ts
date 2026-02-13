import fs from "node:fs";
import path from "node:path";

export interface AuditEntry {
  operation: "create" | "update" | "delete" | "complete";
  service: "calendar" | "tasks";
  title: string;
  googleId: string;
  changes?: Record<string, unknown>;
  timestamp: string;
  source: "mcp";
}

export interface AuditLogger {
  log(entry: AuditEntry): Promise<void>;
}

interface AuditFile {
  month: string;
  entries: AuditEntry[];
}

class FileAuditLogger implements AuditLogger {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async log(entry: AuditEntry): Promise<void> {
    // Ensure directory exists
    fs.mkdirSync(this.dir, { recursive: true });

    const month = entry.timestamp.slice(0, 7); // "YYYY-MM"
    const filePath = path.join(this.dir, `operations_${month}.json`);

    let file: AuditFile;

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      file = JSON.parse(raw) as AuditFile;
      if (!Array.isArray(file.entries)) {
        // Corrupted file — reset
        file = { month, entries: [] };
      }
    } catch {
      // File doesn't exist or is unreadable
      file = { month, entries: [] };
    }

    file.entries.push(entry);
    fs.writeFileSync(filePath, JSON.stringify(file, null, 2));
  }
}

class NoOpAuditLogger implements AuditLogger {
  async log(): Promise<void> {
    // Intentionally empty
  }
}

export function createAuditLogger(auditLogDir: string | null): AuditLogger {
  if (!auditLogDir) {
    return new NoOpAuditLogger();
  }
  return new FileAuditLogger(auditLogDir);
}
