import { describe, it, expect } from "vitest";
import { GuardrailError, apiError } from "../../src/errors.js";

describe("GuardrailError", () => {
  it("produces correct structured output", () => {
    const err = new GuardrailError("DAILY_LIMIT_REACHED", "Limit hit");
    const structured = err.toStructured();
    expect(structured).toEqual({
      error: true,
      code: "DAILY_LIMIT_REACHED",
      message: "Limit hit",
    });
  });

  it("is an instance of Error", () => {
    const err = new GuardrailError("PROTECTED_RESOURCE", "Protected");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GuardrailError");
    expect(err.message).toBe("Protected");
  });

  it("stores the error code", () => {
    const err = new GuardrailError("PAST_EVENT_PROTECTED", "Too old");
    expect(err.code).toBe("PAST_EVENT_PROTECTED");
  });
});

describe("apiError", () => {
  it("maps 401 to AUTH_EXPIRED", () => {
    const err = apiError(401, "Token revoked");
    expect(err.code).toBe("AUTH_EXPIRED");
    expect(err.message).toBe("Token revoked");
    expect(err.error).toBe(true);
  });

  it("maps 404 to NOT_FOUND", () => {
    const err = apiError(404, "Event not found");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("maps 429 to API_ERROR", () => {
    const err = apiError(429, "Rate limited");
    expect(err.code).toBe("API_ERROR");
  });

  it("maps 500 to API_ERROR", () => {
    const err = apiError(500, "Internal server error");
    expect(err.code).toBe("API_ERROR");
  });

  it("maps unknown status to API_ERROR", () => {
    const err = apiError(503, "Service unavailable");
    expect(err.code).toBe("API_ERROR");
    expect(err.message).toBe("Service unavailable");
  });
});
