import type { APIClient } from "../../clients/types";
import type { AuthenticatedPrincipal } from "../../core/security/principal";

export interface AuthenticationResult {
  principal: AuthenticatedPrincipal;

  client?: APIClient;
}