import { z } from "zod";
import { isTransactionalEmailAddress } from "./transactional-email.ts";

const role = z.enum(["owner", "admin", "editor", "contributor", "viewer"]);
const reasonCode = z.enum(["cleanup", "email-disabled", "incident", "launch-gate", "maintenance", "operator"]);

export const operatorInvitationCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("issue"),
    email: z.string().trim().email().max(320),
    expiresInSeconds: z.number().int().min(15 * 60).max(7 * 24 * 60 * 60),
    purpose: z.enum(["initial-owner", "member"]),
    role
  }).strict(),
  z.object({
    action: z.literal("revoke"),
    invitationId: z.string().uuid()
  }).strict(),
  z.object({ action: z.literal("revoke-all") }).strict(),
  z.object({
    action: z.literal("application-delete"),
    email: z.string().trim().email().max(254).refine(isTransactionalEmailAddress)
  }).strict(),
  z.object({
    action: z.literal("control"),
    reasonCode,
    state: z.enum(["active", "paused"])
  }).strict(),
  z.object({
    action: z.literal("cleanup"),
    limit: z.number().int().min(1).max(10_000).optional()
  }).strict()
]);

export type OperatorInvitationCommand = z.infer<typeof operatorInvitationCommandSchema>;
