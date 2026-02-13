export type ErrorCode =
  | "DAILY_LIMIT_REACHED"
  | "PROTECTED_RESOURCE"
  | "PAST_EVENT_PROTECTED"
  | "RECURRING_SERIES_BLOCKED"
  | "AUTH_EXPIRED"
  | "AUTH_MISSING"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "API_ERROR";

export interface StructuredError {
  error: true;
  code: ErrorCode;
  message: string;
}

export class GuardrailError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GuardrailError";
  }

  toStructured(): StructuredError {
    return { error: true, code: this.code, message: this.message };
  }
}

export function apiError(status: number, message: string): StructuredError {
  if (status === 401) return { error: true, code: "AUTH_EXPIRED", message };
  if (status === 404) return { error: true, code: "NOT_FOUND", message };
  return { error: true, code: "API_ERROR", message };
}
