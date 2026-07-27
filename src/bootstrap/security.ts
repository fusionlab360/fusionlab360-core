import { registerJwtService } from "../core/security/jwt";
import { createJwtService } from "../core/security/provider/jwt";

import { registerUserRepository } from "../domain/user/repository";
import { memoryUserRepository } from "../domain/user/provider/memory";

let initialized = false;

export function bootstrapSecurity(): void {
  if (initialized) {
    return;
  }


  // JWT Provider
  registerJwtService(
    createJwtService({
      // Temporary values until config/env is introduced
      secret: "fusionlab360-development-secret",
      issuer: "fusionlab360-core",
      audience: "fusionlab360-extension",
    }),
  );

  // User Repository
  registerUserRepository(memoryUserRepository);

  initialized = true;
}