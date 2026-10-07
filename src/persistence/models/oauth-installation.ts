export type OAuthAccountType =
  | "company"
  | "location";


export interface OAuthInstallation {
  provider: string;

  accountType:
    OAuthAccountType;

  externalAccountId: string;

  externalUserId?:
    string | null;

  accessToken: string;

  refreshToken?:
    string | null;

  accessTokenExpiresAt?:
    number | null;

  refreshLockToken?:
    string | null;

  refreshLockExpiresAt?:
    number | null;

  metadata?:
    string | null;

  createdAt: string;

  updatedAt: string;
}