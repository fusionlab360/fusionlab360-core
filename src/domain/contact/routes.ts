import { Hono } from "hono";
import {
  createContactController,
  getContactController,
  updateContactController,
  deleteContactController,
} from "./controller";

import type { AppBindings } from "../../config/app";
import type { AppVariables } from "../../config/app";
import { requirePermission } from "../../middleware/authorization";

import { requireClinicContactSync } from "./service";

const contactRoutes = new Hono<{
  Bindings: AppBindings;
  Variables: AppVariables;
}>();

contactRoutes.post("/", requirePermission("contacts:create"), createContactController);
contactRoutes.get("/clinic-sync-capability", requirePermission("contacts:create"), (c) => {
  requireClinicContactSync(c.get("context"));
  c.header("Cache-Control", "no-store");
  return c.json({ clinicNotesSync: 2 });
});
contactRoutes.get("/", requirePermission("contacts:read"), getContactController);
contactRoutes.put("/", requirePermission("contacts:update"), updateContactController);
contactRoutes.delete("/", requirePermission("contacts:delete"), deleteContactController);

export default contactRoutes;
