import type {Request, Response} from "express";
import * as logger from "firebase-functions/logger";
import {
  availabilityQuerySchema,
  hlIdSchema,
  listAppointmentsQuerySchema,
  listCalendarsQuerySchema,
  listContactsQuerySchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  searchContactsQuerySchema,
} from "../schemas/proxy.schema";
import * as hlProxy from "../services/hl-proxy.service";

const uid = (res: Response): string => res.locals.identity.uid;
const hlId = (req: Request, name: string): string =>
  hlIdSchema.parse(req.params[name]);

export async function listContacts(req: Request, res: Response) {
  const userId = uid(res);
  logger.info("listContacts called", {userId});
  const query = listContactsQuerySchema.parse(req.query);
  const result = await hlProxy.listContacts(userId, query);
  logger.info("listContacts completed", {userId, result});
  res.json(result);
}

export async function searchContacts(req: Request, res: Response) {
  const userId = uid(res);
  logger.info("searchContacts called", {userId, query: req.query});
  const query = searchContactsQuerySchema.parse(req.query);
  const result = await hlProxy.searchContacts(userId, query);
  logger.info("searchContacts completed", {userId, result});
  res.json(result);
}

export async function createContact(req: Request, res: Response) {
  const userId = uid(res);
  logger.info("createContact called", {userId, body: req.body});
  const result = await hlProxy.createContact(userId, req.body);
  logger.info("createContact completed", {userId, result});
  res.status(201).json(result);
}

export async function updateContact(req: Request, res: Response) {
  const userId = uid(res);
  const contactId = hlId(req, "contactId");
  logger.info("updateContact called", {userId, contactId, body: req.body});
  const result = await hlProxy.updateContact(userId, contactId, req.body);
  logger.info("updateContact completed", {userId, contactId, result});
  res.json(result);
}

export async function listConversations(req: Request, res: Response) {
  const userId = uid(res);
  logger.info("listConversations called", {userId});
  const query = listConversationsQuerySchema.parse(req.query);
  const result = await hlProxy.listConversations(userId, query);
  logger.info("listConversations completed", {userId, result});
  res.json(result);
}

export async function listMessages(req: Request, res: Response) {
  const userId = uid(res);
  const conversationId = hlId(req, "conversationId");
  logger.info("listMessages called", {userId, conversationId});
  const query = listMessagesQuerySchema.parse(req.query);
  const result = await hlProxy.listMessages(userId, conversationId, query);
  logger.info("listMessages completed", {userId, conversationId, result});
  res.json(result);
}

export async function sendMessage(req: Request, res: Response) {
  const userId = uid(res);
  const conversationId = hlId(req, "conversationId");
  logger.info("sendMessage called", {userId, conversationId, body: req.body});
  const result = await hlProxy.sendMessage(userId, conversationId, req.body);
  logger.info("sendMessage completed", {userId, conversationId, result});
  res.status(201).json(result);
}

export async function listCalendars(req: Request, res: Response) {
  const userId = uid(res);
  logger.info("listCalendars called", {userId});
  listCalendarsQuerySchema.parse(req.query);
  const result = await hlProxy.listCalendars(userId);
  logger.info("listCalendars completed", {userId, result});
  res.json(result);
}

export async function listAppointments(req: Request, res: Response) {
  const userId = uid(res);
  logger.info("listAppointments called", {userId, query: req.query});
  const query = listAppointmentsQuerySchema.parse(req.query);
  const result = await hlProxy.listAppointments(userId, query);
  logger.info("listAppointments completed", {userId, result});
  res.json(result);
}

export async function getAvailability(req: Request, res: Response) {
  const userId = uid(res);
  const calendarId = hlId(req, "calendarId");
  logger.info("getAvailability called", {userId, calendarId, query: req.query});
  const query = availabilityQuerySchema.parse(req.query);
  const result = await hlProxy.getAvailability(userId, calendarId, query);
  logger.info("getAvailability completed", {userId, calendarId, result});
  res.json(result);
}
