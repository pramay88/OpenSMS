// SPDX-License-Identifier: Apache-2.0
import type { Gateway } from "./db/schema.js";

export type AppVariables = {
  clientId: string;
  clientName: string;
  gateway: Gateway;
};

export type AppEnv = {
  Variables: AppVariables;
};
