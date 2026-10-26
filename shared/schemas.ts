// Request validation shared by server (authoritative) and client forms.
import { z } from 'zod';
import { isIsoDate } from './dates.js';
import { RESOLUTION_OUTCOMES, UPDATE_SOURCES } from './types.js';

const isoDate = z.string().refine(isIsoDate, 'Use a valid date (YYYY-MM-DD).');
const id = z.number().int().positive();
const version = z.number().int().positive();
const requiredNote = z.string().trim().min(1, 'Add a short note.').max(500, 'Keep the note under 500 characters.');
const optionalNote = z.string().trim().max(500, 'Keep the note under 500 characters.').default('');
const source = z.enum(UPDATE_SOURCES as [string, ...string[]], { error: 'Choose a source.' });
const outcome = z.enum(RESOLUTION_OUTCOMES, { error: 'Choose an outcome.' });

/** Optional "Save and resolve" payload. Absent means Save changes. Targets one exact open issue. */
const resolvePayload = z.object({
  issueId: id,
  expectedIssueVersion: version,
  outcome,
  note: optionalNote,
});
export type ResolvePayload = z.infer<typeof resolvePayload>;

export const updateArrivalSchema = z.object({
  expectedArrival: isoDate.nullable(),
  source,
  note: optionalNote,
  version,
  resolve: resolvePayload.optional(),
});
export type UpdateArrivalInput = z.infer<typeof updateArrivalSchema>;

export const splitSchema = z.object({
  version,
  source,
  note: optionalNote,
  parts: z
    .array(
      z.object({
        quantity: z.number().int('Quantities must be whole numbers.').positive('Quantities must be positive.'),
        expectedArrival: isoDate.nullable(),
      }),
    )
    .min(2, 'Split into at least two deliveries.')
    .max(10, 'Split into at most ten deliveries.'),
  resolve: resolvePayload.optional(),
});
export type SplitInput = z.infer<typeof splitSchema>;

export const resolveIssueSchema = z.object({
  issueId: id,
  expectedIssueVersion: version,
  expectedDeliveryVersion: version,
  outcome,
  note: optionalNote,
});
export type ResolveIssueInput = z.infer<typeof resolveIssueSchema>;

export const createFollowUpSchema = z.object({
  deliveryId: id.nullable(),
  dueDate: isoDate,
  note: requiredNote,
});
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>;

export const patchFollowUpSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('edit'),
    version,
    deliveryId: id.nullable(),
    dueDate: isoDate,
    note: requiredNote,
  }),
  z.object({
    action: z.literal('complete'),
    version,
    completionNote: optionalNote,
  }),
]);
export type PatchFollowUpInput = z.infer<typeof patchFollowUpSchema>;

export const resetSchema = z.object({ confirm: z.literal('RESET', { error: 'Type RESET to confirm.' }) });

const isoTimestamp = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)), 'Use an ISO timestamp.');

/** Simulated send: the supplier and the exact eligible delivery versions shown in the preview. */
export const sendOutreachSchema = z.object({
  supplierId: id,
  items: z
    .array(z.object({ deliveryId: id, version }))
    .min(1, 'Choose at least one eligible item.')
    .max(200),
});
export type SendOutreachInput = z.infer<typeof sendOutreachSchema>;

/** Forward-only clock move; `to` must be later than the current demo clock. */
export const advanceClockSchema = z.object({ to: isoTimestamp });

export const patchCallTaskSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), version }),
  z.object({ action: z.literal('complete'), version, note: optionalNote }),
]);
export type PatchCallTaskInput = z.infer<typeof patchCallTaskSchema>;
