// src/core/security/password.ts

/**
 * FusionLab360 Core
 * Password Security Contract
 */

export interface PasswordService {
  /**
   * Hash a plain text password.
   */
  hash(password: string): Promise<string>;

  /**
   * Verify a password against a stored hash.
   */
  verify(password: string, hash: string): Promise<boolean>;

  /**
   * Determine whether an existing hash should be upgraded.
   */
  needsRehash(hash: string): boolean;
}

export class PasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordError";
  }
}

let passwordService: PasswordService | null = null;

/**
 * Registers the active password provider.
 * Called once during application bootstrap.
 */
export function registerPasswordService(service: PasswordService): void {
  passwordService = service;
}

/**
 * Hash a password.
 */
export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);

  if (!passwordService) {
    throw new PasswordError("Password service has not been registered.");
  }

  return passwordService.hash(password);
}

/**
 * Verify password.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  if (!passwordService) {
    throw new PasswordError("Password service has not been registered.");
  }

  return passwordService.verify(password, hash);
}

/**
 * Determine whether the stored hash should be regenerated.
 */
export function needsPasswordRehash(hash: string): boolean {
  if (!passwordService) {
    throw new PasswordError("Password service has not been registered.");
  }

  return passwordService.needsRehash(hash);
}

function validatePassword(password: string): void {
  if (typeof password !== "string") {
    throw new PasswordError("Password must be a string.");
  }

  if (password.trim().length === 0) {
    throw new PasswordError("Password cannot be empty.");
  }

  if (password.length < 8) {
    throw new PasswordError(
      "Password must contain at least 8 characters."
    );
  }
}