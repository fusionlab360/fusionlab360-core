export interface AuthClaims {
  userId: string;
  tenantId: string;
  clientId: string;
  role: string;
  permissions: string[];
}

export interface AccessTokenPayload extends AuthClaims {
  type: "access";
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  userId: string;
  tenantId: string;
  type: "refresh";
  iat: number;
  exp: number;
}