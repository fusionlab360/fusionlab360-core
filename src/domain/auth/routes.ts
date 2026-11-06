import { Hono } from "hono";

import {
  login,
  logout,
  me,
  refresh,
} from "./controller";
import { authMiddleware } from "../../middleware/auth";

export const authRoutes = new Hono();

authRoutes.post("/login", login);
authRoutes.post("/refresh", refresh);
authRoutes.post("/logout", logout);
authRoutes.get("/me", authMiddleware, me);
