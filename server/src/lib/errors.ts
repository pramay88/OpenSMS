// SPDX-License-Identifier: Apache-2.0
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorResponse(error: AppError | Error) {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  };
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  if (process.env.LOG_LEVEL === "silent") return;
  const safe = meta ? sanitizeLogMeta(meta) : undefined;
  console.log(JSON.stringify({ level: "info", message, ...safe }));
}

export function logError(message: string, meta?: Record<string, unknown>): void {
  const safe = meta ? sanitizeLogMeta(meta) : undefined;
  console.error(JSON.stringify({ level: "error", message, ...safe }));
}

export function sanitizeLogMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (
      ["body", "message", "secret", "apiKey", "token", "authorization", "credentials",
        "phone", "to", "idempotencyKey", "error", "details", "record"].includes(key)
    ) {
      sanitized[key] = "[redacted]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitized[key] = sanitizeLogMeta(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
