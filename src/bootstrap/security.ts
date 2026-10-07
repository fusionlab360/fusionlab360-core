import { registerJwtService } from "../core/security/jwt";
import { createJwtService } from "../core/security/provider/jwt";

import { registerUserRepository } from "../domain/user/repository";
import { memoryUserRepository } from "../domain/user/provider/memory";

export interface SecurityEnvironment {

  JWT_SECRET:
    string;

  JWT_ISSUER:
    string;

  JWT_AUDIENCE:
    string;

}


let initialized = false;


export function bootstrapSecurity(
  env:
    SecurityEnvironment,
): void {

  if (initialized) {
    return;
  }


  // ------------------------------------------------------------
  // Validate required security configuration.
  // ------------------------------------------------------------

  if (
    !env.JWT_SECRET?.trim()
  ) {

    throw new Error(
      "JWT_SECRET is not configured.",
    );

  }


  if (
    !env.JWT_ISSUER?.trim()
  ) {

    throw new Error(
      "JWT_ISSUER is not configured.",
    );

  }


  if (
    !env.JWT_AUDIENCE?.trim()
  ) {

    throw new Error(
      "JWT_AUDIENCE is not configured.",
    );

  }


  // ------------------------------------------------------------
  // JWT Provider
  // ------------------------------------------------------------

  registerJwtService(
    createJwtService({

      secret:
        env.JWT_SECRET,

      issuer:
        env.JWT_ISSUER,

      audience:
        env.JWT_AUDIENCE,

    }),
  );


  // ------------------------------------------------------------
  // User Repository
  //
  // Existing repository implementation is retained.
  // ------------------------------------------------------------

  registerUserRepository(
    memoryUserRepository,
  );


  initialized = true;

}