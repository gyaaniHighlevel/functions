import {Router} from "express";
import * as controller from "../controllers/proxy.controller";
import {validateBody} from "../middleware/validate";
import {
  createContactSchema,
  sendMessageSchema,
  updateContactSchema,
} from "../schemas/proxy.schema";
import {asyncHandler} from "../utils/async-handler";

/** The whitelist (spec §5.5): these ten routes are the entire HL surface a
 * generated app can reach. Anything else falls through to the app-level 404
 * — an invented `hl.opportunities.list()` dies here, not at HighLevel. */
export const proxyRoutes = Router();

proxyRoutes.get("/contacts/search",
  asyncHandler(controller.searchContacts));
proxyRoutes.get("/contacts", asyncHandler(controller.listContacts));
proxyRoutes.post("/contacts",
  validateBody(createContactSchema), asyncHandler(controller.createContact));
proxyRoutes.put("/contacts/:contactId",
  validateBody(updateContactSchema), asyncHandler(controller.updateContact));

proxyRoutes.get("/conversations",
  asyncHandler(controller.listConversations));
proxyRoutes.get("/conversations/:conversationId/messages",
  asyncHandler(controller.listMessages));
proxyRoutes.post("/conversations/:conversationId/messages",
  validateBody(sendMessageSchema), asyncHandler(controller.sendMessage));

proxyRoutes.get("/calendars", asyncHandler(controller.listCalendars));
proxyRoutes.get("/calendars/appointments",
  asyncHandler(controller.listAppointments));
proxyRoutes.get("/calendars/:calendarId/availability",
  asyncHandler(controller.getAvailability));
