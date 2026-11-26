import { describe, expect, it } from "vitest";

import {
  hashPassword,
  validateNewPassword,
  verifyPassword,
} from "../../src/modules/auth/password.service.js";

describe("Rasikh password policy", () => {
  it("accepts a password with exactly six characters", () => {
    expect(() => validateNewPassword("secret")).not.toThrow();
  });

  it("rejects passwords shorter than six characters", () => {
    expect(() => validateNewPassword("12345")).toThrow(/PASSWORD_POLICY/);
  });

  it("rejects passwords longer than 128 characters", () => {
    expect(() => validateNewPassword("a".repeat(129))).toThrow(/PASSWORD_POLICY/);
  });

  it("hashes and verifies a six-character password without storing plaintext", async () => {
    const password = "secret";
    const storedHash = await hashPassword(password);

    expect(storedHash).not.toBe(password);
    expect(storedHash.startsWith("scrypt$")).toBe(true);
    await expect(verifyPassword(password, storedHash)).resolves.toBe(true);
    await expect(verifyPassword("secret1", storedHash)).resolves.toBe(false);
  });
});
