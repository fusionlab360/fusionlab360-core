import { bootstrapSecurity } from "./bootstrap/security";
import "./bootstrap/routes";
import { app } from "./config/app";

bootstrapSecurity();

export default app;