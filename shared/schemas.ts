// Request validation shared by server (authoritative) and client forms.
import { z } from 'zod';
import { isIsoDate } from './dates.js';
import { UPDATE_SOURCES } from './types.js';

const isoDate = z.string().refine(isIsoDate, 'Use a valid date (YYYY-MM-DD).');
const id = z.number().int().positive();
const version = z.number().int().positive();
const requiredNote = z.string().trim().min(1, 'Add a short note.').max(500, 'Keep the note under 500 characters.');
const optionalNote = z.string().trim().max(500, 'Keep the note under 500 characters.').default('');
const source = z.enum(UPDATE_SOURCES as [string, ...string[]], { error: 'Choose a source.' });

export const updateArrivalSchema = z.object({
  expectedArrival: isoDate.nullable(),
  source,
  note: optionalNote,
  version,
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
});
export type SplitInput = z.infer<typeof splitSchema>;

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
