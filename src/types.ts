export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function successResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function errorResult(error: { error: true; code: string; message: string }): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(error, null, 2) }],
    isError: true,
  };
}
