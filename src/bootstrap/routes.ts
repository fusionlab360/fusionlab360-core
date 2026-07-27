import { app } from "../config/app";

import { authMiddleware } from "../middleware/auth";

import { authRoutes } from "../domain/auth/routes";
import contactRoutes from "../domain/contact/routes";
import reservationRoutes from "../domain/reservation/routes";

app.get("/", (c) => {
  return c.json({
    name: "FusionLab360 API",
    version: "1.0.0",
    status: "running",
  });
});

app.get("/health", (c) => {
  return c.json({
    success: true,
    message: "API is healthy",
  });
});

// Public Routes
app.route("/auth", authRoutes);

// Protected Routes
app.use("/contacts/*", authMiddleware);
app.use("/reservations/*", authMiddleware);

// Contact CRUD
app.route("/contacts", contactRoutes);

// Reservation Business Process
app.route("/reservations", reservationRoutes);