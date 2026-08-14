// SPDX-License-Identifier: Apache-2.0
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { v4 as uuidv4 } from "uuid";

const SALT_ROUNDS = 12;

export function generateApiKey(): string {
  return `sgk_${randomBytes(32).toString("base64url")}`;
}

export function generateGatewaySecret(): string {
  return randomBytes(32).toString("base64url");
}

export function generateRegistrationToken(): string {
  return `sgr_${randomBytes(24).toString("base64url")}`;
}

export async function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, SALT_ROUNDS);
}

export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateId(): string {
  return uuidv4();
}

export function maskPhone(phone: string): string {
  if (phone.length <= 6) return "***";
  return phone.slice(0, 3) + "***" + phone.slice(-3);
}

export function redactMessageBody(body: string): string {
  return `[redacted:${body.length} chars]`;
}
