import type {
  IntegrationCredentialRequest,
  IntegrationCredentialResolver,
  IntegrationRuntime,
  ResolvedIntegrationCredential,
} from "../../core/integration/runtime";

import {
  createGHLIntegrationRuntime,
} from "../../integrations/gohighlevel/credential-runtime";


export interface IntegrationRuntimeEnvironment {

  DB:
    D1Database;

  GHL_OAUTH_CLIENT_ID:
    string;

  GHL_OAUTH_CLIENT_SECRET:
    string;
}


class UnsupportedIntegrationCredentialResolver
  implements IntegrationCredentialResolver {

  constructor(
    private readonly provider:
      string,
  ) {}


  async resolve(
    request:
      IntegrationCredentialRequest,
  ): Promise<
    ResolvedIntegrationCredential
  > {

    throw new Error(
      `Integration credential runtime is not implemented for provider=${this.provider}. ` +
      `Requested provider=${request.provider}.`,
    );
  }
}


export function createIntegrationRuntime(
  provider:
    string,

  env:
    IntegrationRuntimeEnvironment,
): IntegrationRuntime {

  switch (
    provider
  ) {

    case "gohighlevel":

      return createGHLIntegrationRuntime(
        env.DB,
        {
          GHL_OAUTH_CLIENT_ID:
            env.GHL_OAUTH_CLIENT_ID,

          GHL_OAUTH_CLIENT_SECRET:
            env.GHL_OAUTH_CLIENT_SECRET,
        },
      );


    default:

      return {
        credentials:
          new UnsupportedIntegrationCredentialResolver(
            provider,
          ),
      };
  }
}