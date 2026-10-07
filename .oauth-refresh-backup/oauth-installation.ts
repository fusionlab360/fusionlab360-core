export type OAuthAccountType =
  | "company"
  | "location"
  | string;


export interface OAuthInstallation {

  provider:
    string;

  accountType:
    OAuthAccountType;

  externalAccountId:
    string;

  externalUserId:
    string | null;

  accessToken:
    string;

  refreshToken:
    string | null;

  metadata:
    string | null;

  createdAt:
    string;

  updatedAt:
    string;
}