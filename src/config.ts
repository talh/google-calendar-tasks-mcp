import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export interface ServerConfig {
  timezone: string;
  credentialsPath: string;
  auditLogDir: string | null;
  guardrailsPath: string;
  testMode: boolean;
}

function getDefaultCredentialsPath(): string {
  const appName = "google-calendar-tasks-mcp";
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), appName, "credentials.json");
  }
  return path.join(os.homedir(), ".config", appName, "credentials.json");
}

export function loadConfig(): ServerConfig {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  return {
    timezone:
      process.env.GOOGLE_MCP_TIMEZONE ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    credentialsPath:
      process.env.GOOGLE_MCP_CREDENTIALS_PATH ??
      getDefaultCredentialsPath(),
    auditLogDir:
      process.env.GOOGLE_MCP_AUDIT_LOG_DIR ?? null,
    guardrailsPath:
      process.env.GOOGLE_MCP_GUARDRAILS_PATH ??
      path.resolve(__dirname, "..", "guardrails.json"),
    testMode:
      process.env.GOOGLE_MCP_TEST_MODE === "true",
  };
}
