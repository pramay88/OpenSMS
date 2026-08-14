// SPDX-License-Identifier: Apache-2.0
import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js";

export class PhoneValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhoneValidationError";
  }
}

export function normalizePhoneNumber(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new PhoneValidationError("Phone number is required");
  }

  if (!isValidPhoneNumber(trimmed)) {
    throw new PhoneValidationError("Invalid phone number. Use E.164 format (e.g. +1234567890)");
  }

  const parsed = parsePhoneNumber(trimmed);
  return parsed.format("E.164");
}
