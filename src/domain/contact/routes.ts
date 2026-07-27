import { Hono } from "hono";
import {
  createContactController,
  getContactController,
  updateContactController,
  deleteContactController,
} from "./controller";

import type { AppBindings } from "../../config/app";

const contactRoutes = new Hono<{
  Bindings: AppBindings;
}>();

contactRoutes.post("/", createContactController);
contactRoutes.get("/", getContactController);
contactRoutes.put("/", updateContactController);
contactRoutes.delete("/", deleteContactController);

export default contactRoutes;