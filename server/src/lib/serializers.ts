// SPDX-License-Identifier: Apache-2.0
import type { Message } from "../db/schema.js";

export function toMessageResponse(message: Message) {
  return {
    id: message.id,
    to: message.to,
    status: message.status,
    gatewayId: message.gatewayId,
    createdAt: message.createdAt.toISOString(),
    expiresAt: message.expiresAt.toISOString(),
    assignedAt: message.assignedAt?.toISOString() ?? null,
    sentAt: message.sentAt?.toISOString() ?? null,
    failedAt: message.failedAt?.toISOString() ?? null,
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
  };
}

export function toJobResponse(message: Message) {
  return {
    id: message.id,
    to: message.to,
    message: message.body,
    expiresAt: message.expiresAt.toISOString(),
    status: message.status,
  };
}
