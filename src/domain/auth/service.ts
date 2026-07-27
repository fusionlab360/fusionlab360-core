import { signAccessToken, signRefreshToken } from "../../core/security/jwt";
import { verifyPassword } from "../../core/security/password";

import { userService } from "../user/service";

import type {
  CurrentUser,
  LoginRequest,
  LoginResponse,
  RefreshRequest,
  RefreshResponse,
} from "./types";

export class AuthService {
  async login(
    request: LoginRequest,
  ): Promise<LoginResponse> {
    const user = await userService.findByEmail(request.email);

    if (!user) {
      throw new Error("Invalid email or password.");
    }

    if (!user.active) {
      throw new Error("User account is inactive.");
    }

    const validPassword = await verifyPassword(
      request.password,
      user.passwordHash,
    );

    if (!validPassword) {
      throw new Error("Invalid email or password.");
    }

    const accessToken = await signAccessToken({
      userId: user.id,
      tenantId: user.tenantId,
      clientId: user.clientId,
      role: user.role,
      permissions: user.permissions,
    });

    const refreshToken = await signRefreshToken({
      userId: user.id,
      tenantId: user.tenantId,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 3600,
    };
  }

  async refresh(
    request: RefreshRequest,
  ): Promise<RefreshResponse> {
    throw new Error("Not implemented.");
  }

  async logout(): Promise<void> {
    return;
  }

  async currentUser(
  userId: string,
): Promise<CurrentUser> {
  const user = await userService.findById(userId);

  if (!user) {
    throw new Error("User not found.");
  }

  return {
    id: user.id,
    tenantId: user.tenantId,
    clientId: user.clientId,
    role: user.role,
    permissions: user.permissions,
  };
}
}

export const authService = new AuthService();