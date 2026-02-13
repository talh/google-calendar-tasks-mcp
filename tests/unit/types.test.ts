import { describe, it, expect } from "vitest";
import { successResult, errorResult } from "../../src/types.js";

describe("successResult", () => {
  it("wraps data in MCP text content format", () => {
    const result = successResult({ id: "123", title: "Test" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: "123",
      title: "Test",
    });
    expect(result.isError).toBeUndefined();
  });

  it("handles arrays", () => {
    const result = successResult([1, 2, 3]);
    expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    const result = successResult(null);
    expect(result.content[0].text).toBe("null");
  });
});

describe("errorResult", () => {
  it("wraps error with isError flag", () => {
    const result = errorResult({
      error: true,
      code: "NOT_FOUND",
      message: "Event not found",
    });
    expect(result.content).toHaveLength(1);
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe(true);
    expect(parsed.code).toBe("NOT_FOUND");
    expect(parsed.message).toBe("Event not found");
  });
});
