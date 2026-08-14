// SPDX-License-Identifier: Apache-2.0
/**
 * Example external client for the SMS Gateway.
 *
 * This demonstrates how ANY application can send SMS through the gateway.
 * OTP generation and verification belong to YOUR application — not the gateway.
 *
 * Example OTP flow (in your app, not here):
 *   1. Generate code: const otp = String(Math.floor(100000 + Math.random() * 900000))
 *   2. Send via gateway: POST /api/v1/messages { to, message: `Your code is ${otp}` }
 *   3. Store otp hash server-side with expiry
 *   4. Verify user input against stored hash
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";

const GATEWAY_URL = process.env.GATEWAY_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
const API_KEY = process.env.API_KEY ?? "";
const TEST_PHONE = process.env.TEST_PHONE ?? "+12025550100";
const TEST_MESSAGE = process.env.TEST_MESSAGE ?? "Hello from SMS Gateway example client";

if (!API_KEY) {
  console.error("Set API_KEY in .env (create one with: npm run create-client --prefix ../server)");
  process.exit(1);
}

async function sendMessage(to: string, message: string, idempotencyKey?: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetch(`${GATEWAY_URL}/api/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ to, message }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Send failed (${res.status}): ${JSON.stringify(err)}`);
  }

  return res.json() as Promise<{ id: string; status: string }>;
}

async function getMessageStatus(id: string) {
  const res = await fetch(`${GATEWAY_URL}/api/v1/messages/${id}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Status check failed (${res.status}): ${JSON.stringify(err)}`);
  }

  return res.json() as Promise<{ id: string; status: string; errorCode?: string; errorMessage?: string }>;
}

async function pollUntilTerminal(id: string, maxAttempts = 30, intervalMs = 2000) {
  const terminal = new Set(["SENT", "FAILED", "EXPIRED"]);
  for (let i = 0; i < maxAttempts; i++) {
    const status = await getMessageStatus(id);
    console.log(`  [${i + 1}] status: ${status.status}`);
    if (terminal.has(status.status)) {
      return status;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Polling timed out");
}

async function main() {
  console.log("SMS Gateway Example Client");
  console.log("Gateway:", GATEWAY_URL);
  console.log("");

  const idempotencyKey = randomUUID();
  console.log("Sending message with Idempotency-Key:", idempotencyKey);

  const queued = await sendMessage(TEST_PHONE, TEST_MESSAGE, idempotencyKey);
  console.log("Queued:", queued);

  console.log("\nPolling message status...");
  const final = await pollUntilTerminal(queued.id);
  console.log("\nFinal status:", final);

  console.log("\nDemonstrating idempotency (same key, no duplicate SMS)...");
  const duplicate = await sendMessage(TEST_PHONE, TEST_MESSAGE, idempotencyKey);
  console.log("Same message ID returned:", duplicate.id === queued.id);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
