import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all GOOGLE_MCP_ env vars before each test
    delete process.env.GOOGLE_MCP_TIMEZONE;
    delete process.env.GOOGLE_MCP_CREDENTIALS_PATH;
    delete process.env.GOOGLE_MCP_AUDIT_LOG_DIR;
    delete process.env.GOOGLE_MCP_GUARDRAILS_PATH;
    delete process.env.GOOGLE_MCP_TEST_MODE;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it("returns a valid timezone by default", () => {
    const config = loadConfig();
    // Should be a non-empty string (system timezone)
    expect(config.timezone).toBeTruthy();
    expect(typeof config.timezone).toBe("string");
  });

  it("uses GOOGLE_MCP_TIMEZONE when set", () => {
    process.env.GOOGLE_MCP_TIMEZONE = "America/New_York";
    const config = loadConfig();
    expect(config.timezone).toBe("America/New_York");
  });

  it("uses GOOGLE_MCP_CREDENTIALS_PATH when set", () => {
    process.env.GOOGLE_MCP_CREDENTIALS_PATH = "/custom/path/creds.json";
    const config = loadConfig();
    expect(config.credentialsPath).toBe("/custom/path/creds.json");
  });

  it("returns OS-specific default credentials path when not set", () => {
    const config = loadConfig();
    expect(config.credentialsPath).toContain("google-calendar-tasks-mcp");
    expect(config.credentialsPath).toContain("credentials.json");
  });

  it("sets auditLogDir to null when not set", () => {
    const config = loadConfig();
    expect(config.auditLogDir).toBeNull();
  });

  it("uses GOOGLE_MCP_AUDIT_LOG_DIR when set", () => {
    process.env.GOOGLE_MCP_AUDIT_LOG_DIR = "/var/log/mcp";
    const config = loadConfig();
    expect(config.auditLogDir).toBe("/var/log/mcp");
  });

  it("defaults testMode to false", () => {
    const config = loadConfig();
    expect(config.testMode).toBe(false);
  });

  it("sets testMode to true when GOOGLE_MCP_TEST_MODE is 'true'", () => {
    process.env.GOOGLE_MCP_TEST_MODE = "true";
    const config = loadConfig();
    expect(config.testMode).toBe(true);
  });

  it("keeps testMode false for non-'true' values", () => {
    process.env.GOOGLE_MCP_TEST_MODE = "yes";
    const config = loadConfig();
    expect(config.testMode).toBe(false);
  });

  it("returns a guardrails path ending in guardrails.json by default", () => {
    const config = loadConfig();
    expect(config.guardrailsPath).toContain("guardrails.json");
  });

  it("uses GOOGLE_MCP_GUARDRAILS_PATH when set", () => {
    process.env.GOOGLE_MCP_GUARDRAILS_PATH = "/custom/guardrails.json";
    const config = loadConfig();
    expect(config.guardrailsPath).toBe("/custom/guardrails.json");
  });
});
