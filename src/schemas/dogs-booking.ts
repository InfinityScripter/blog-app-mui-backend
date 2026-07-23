import { z } from 'zod';

const dateTimeSchema = z.string().trim().datetime({ offset: true });

const optionalDateTimeSchema = z.string().trim().datetime({ offset: true }).optional();

const queryStringSchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}, z.string().trim().min(1).optional());

export const dogsBookingSourceSchema = z.enum(['site', 'telegram']);

export const dogsBookingStatusSchema = z.enum(['pending', 'confirmed', 'declined', 'cancelled']);

export const dogsSlotsQuerySchema = z.object({
  from: queryStringSchema.pipe(optionalDateTimeSchema),
  to: queryStringSchema.pipe(optionalDateTimeSchema),
});

export const dogsClientTokenQuerySchema = z.object({
  token: z.preprocess((value) => {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }, z.string().trim().min(20)),
});

export const dogsIdQuerySchema = z.object({
  id: z.preprocess((value) => {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }, z.string().trim().min(1).max(120)),
});

export const createDogsSlotSchema = z
  .object({
    startsAt: dateTimeSchema,
    endsAt: dateTimeSchema,
  })
  .refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
    message: 'endsAt must be after startsAt',
    path: ['endsAt'],
  });

export const updateDogsSlotSchema = z.object({
  isActive: z.boolean(),
});

// Batch slot creation: one calendar day + a list of explicit time intervals.
// The admin picks a date and the hours to open; the client sends each interval
// as a {startsAt, endsAt} pair. Keeps the day's slots in a single request.
export const createDogsSlotsBatchSchema = z.object({
  slots: z
    .array(
      z
        .object({
          startsAt: dateTimeSchema,
          endsAt: dateTimeSchema,
        })
        .refine((value) => new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(), {
          message: 'endsAt must be after startsAt',
          path: ['endsAt'],
        })
    )
    .min(1, 'Add at least one slot')
    .max(48, 'Too many slots in one request'),
});

export const createDogsBookingRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(40),
  email: z.string().trim().toLowerCase().email().max(160).optional(),
  dog: z.string().trim().max(160).optional(),
  comment: z.string().trim().max(1000).optional(),
  serviceId: z.string().trim().min(1).max(80),
  slotId: z.string().trim().min(1).max(80),
  source: dogsBookingSourceSchema.default('site'),
});

export const updateDogsBookingStatusSchema = z.object({
  status: dogsBookingStatusSchema,
});

export const cancelDogsBookingRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(80),
});

export const dogsAdminLoginSchema = z.object({
  password: z.string().min(1),
});

// Web Push subscription payload — mirrors the browser's
// JSON.stringify(PushSubscription): an endpoint URL plus the p256dh/auth keys.
const dogsPushSubscriptionSchema = z.object({
  endpoint: z.string().trim().url().max(2000),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(500),
    auth: z.string().trim().min(1).max(500),
  }),
});

export const dogsPushSubscribeSchema = z.object({
  accessToken: z.string().trim().min(20),
  subscription: dogsPushSubscriptionSchema,
});

export const dogsPushUnsubscribeSchema = z.object({
  accessToken: z.string().trim().min(20),
  endpoint: z.string().trim().url().max(2000),
});

// Owner toggle for the dogsBooking flag from the dogs /admin.
export const dogsSettingsUpdateSchema = z.object({
  enabled: z.boolean(),
});

export type CreateDogsBookingRequestInput = z.infer<typeof createDogsBookingRequestSchema>;
export type CreateDogsSlotInput = z.infer<typeof createDogsSlotSchema>;
export type CreateDogsSlotsBatchInput = z.infer<typeof createDogsSlotsBatchSchema>;
export type DogsBookingStatus = z.infer<typeof dogsBookingStatusSchema>;
export type DogsSlotsQuery = z.infer<typeof dogsSlotsQuerySchema>;
export type DogsPushSubscriptionInput = z.infer<typeof dogsPushSubscriptionSchema>;
