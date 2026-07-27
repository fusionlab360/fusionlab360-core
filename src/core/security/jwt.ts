import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from "./types";

export interface JwtService {
  signAccessToken(
    payload: Omit<AccessTokenPayload, "iat" | "exp" | "type">,
  ): Promise<string>;

  signRefreshToken(
    payload: Omit<RefreshTokenPayload, "iat" | "exp" | "type">,
  ): Promise<string>;

  verifyAccessToken(token: string): Promise<AccessTokenPayload>;

  verifyRefreshToken(token: string): Promise<RefreshTokenPayload>;
}

export class JwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtError";
  }
}

let jwtService: JwtService | null = null;

export function registerJwtService(service: JwtService): void {
  jwtService = service;
}

function getService(): JwtService {
  if (!jwtService) {
    throw new JwtError("JWT service has not been registered.");
  }

  return jwtService;
}

export async function signAccessToken(
  payload: Omit<AccessTokenPayload, "iat" | "exp" | "type">,
): Promise<string> {
  return getService().signAccessToken(payload);
}

export async function signRefreshToken(
  payload: Omit<RefreshTokenPayload, "iat" | "exp" | "type">,
): Promise<string> {
  return getService().signRefreshToken(payload);
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload> {
  return getService().verifyAccessToken(token);
}

export async function verifyRefreshToken(
  token: string,
): Promise<RefreshTokenPayload> {
  return getService().verifyRefreshToken(token);
}