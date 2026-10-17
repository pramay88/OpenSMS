import { describe, expect, it } from "vitest";
import type { Database } from "../src/db/client.js";
import { messageEvents } from "../src/db/schema.js";
import { createMessage } from "../src/services/gateway-service.js";

describe("createMessage transaction boundary", () => {
  it("rolls back the message when the initial event fails", async () => {
    let committed = false;
    let rolledBack = false;
    let messageInserted = false;

    const transaction = async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        insert: (table: unknown) => ({
          values: (values: unknown) => {
            if (table === messageEvents) {
              return Promise.reject(new Error("event insert failed"));
            }

            messageInserted = true;
            return {
              onConflictDoNothing: () => ({
                returning: async () => [
                  {
                    id: "message-1",
                    clientId: "client-1",
                    to: "+12025550100",
                    body: "hello",
                    status: "QUEUED",
                    idempotencyKey: "idem-1",
                    gatewayId: null,
                    createdAt: new Date(),
                    expiresAt: new Date(),
                    assignedAt: null,
                    claimedAt: null,
                    claimExpiresAt: null,
                    sentAt: null,
                    failedAt: null,
                    errorCode: null,
                    errorMessage: null,
                    attemptCount: 0,
                  },
                ],
              }),
            };
          },
        }),
      };

      try {
        const result = await callback(tx);
        committed = true;
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    };

    await expect(
      createMessage(
        { transaction } as unknown as Database,
        "client-1",
        "+12025550100",
        "hello",
        "idem-1"
      )
    ).rejects.toThrow("event insert failed");

    expect(messageInserted).toBe(true);
    expect(committed).toBe(false);
    expect(rolledBack).toBe(true);
  });
});
