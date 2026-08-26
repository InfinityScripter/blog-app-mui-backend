import { z } from 'zod';

// Request body schemas for the admin settings toggles. The key allow-list is
// deliberately narrower than the full FlagKey union — auto-publish can never
// flip an unrelated flag like pdCollection (and vice versa).

export const autoPublishToggleSchema = z.object({
  key: z.enum(['autoPublishReleases', 'autoPublishNews']),
  enabled: z.boolean(),
});

export const pdCollectionToggleSchema = z.object({
  enabled: z.boolean(),
});
