import { SignJWT, jwtVerify } from "jose";

import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from "../types";

import type { JwtService } from "../jwt";

const encoder = new TextEncoder();

export class JoseJwtService implements JwtService {
  constructor(
    private readonly secret: string,
    private readonly issuer: string,
    private readonly audience: string,
  ) {}

  async signAccessToken(
    payload: Omit<AccessTokenPayload, "iat" | "exp" | "type">,
  ): Promise<string> {
    return new SignJWT({
      ...payload,
      type: "access",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(encoder.encode(this.secret));
  }

  async signRefreshToken(
    payload: Omit<RefreshTokenPayload, "iat" | "exp" | "type">,
  ): Promise<string> {
    return new SignJWT({
      ...payload,
      type: "refresh",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime("30d")
      .sign(encoder.encode(this.secret));
  }

  async verifyAccessToken(
    token: string,
  ): Promise<AccessTokenPayload> {
    const { payload } = await jwtVerify(
      token,
      encoder.encode(this.secret),
      {
        issuer: this.issuer,
        audience: this.audience,
      },
    );

    return payload as unknown as AccessTokenPayload;
  }

  async verifyRefreshToken(
    token: string,
  ): Promise<RefreshTokenPayload> {
    const { payload } = await jwtVerify(
      token,
      encoder.encode(this.secret),
      {
        issuer: this.issuer,
        audience: this.audience,
      },
    );

   return payload as unknown as RefreshTokenPayload;
  }
}

export function createJwtService(options: {
  secret: string;
  issuer: string;
  audience: string;
}): JwtService {
  return new JoseJwtService(
    options.secret,
    options.issuer,
    options.audience,
  );
}