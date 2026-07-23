import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { validateBody } from '@/src/middlewares/validate';
import { settingsService } from '@/src/services/settings';
import { withMethods } from '@/src/middlewares/with-methods';
import { dogsSettingsUpdateSchema } from '@/src/schemas/dogs-booking';
import { requireDogsAdmin } from '@/src/middlewares/require-dogs-admin';

// Dogs owner's settings surface, behind the dogs-admin Bearer session (separate
// from the blog's JWT admin — different person, different product). GET returns
// the flag snapshot the /admin toggle binds to; PATCH flips dogsBooking, the
// booking-intake master switch, without a redeploy.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === HTTP_METHOD.GET) {
      // Return ONLY the dogs-owned flag — never the blog's pdCollection. This is
      // a separate auth domain (dogs owner ≠ blog admin), so getFlags() (which
      // is blog-wide) would leak a cross-product flag to this Bearer session.
      const dogsBooking = await settingsService.getFlag('dogsBooking');
      return ok(res, { flags: { dogsBooking } });
    }

    // PATCH — body already validated to { enabled: boolean } by validateBody.
    const { enabled } = req.body as { enabled: boolean };
    await settingsService.setFlag('dogsBooking', enabled);
    emitAudit(req, {
      action: 'dogs.settings.booking_toggled',
      targetType: 'setting',
      targetId: 'dogsBooking',
      metadata: { enabled },
    });
    return ok(
      res,
      { dogsBooking: enabled },
      { message: enabled ? 'Онлайн-запись включена' : 'Онлайн-запись выключена' }
    );
  } catch (error) {
    return sendError(res, error);
  }
}

// Validate only the mutating method; GET has no body. Mirrors the dogs admin
// slots route's validatePostOnly shape.
async function validatePatchOnly(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === HTTP_METHOD.PATCH) {
    return validateBody(dogsSettingsUpdateSchema)(handler)(req, res);
  }
  return handler(req, res);
}

export default requireDogsAdmin(
  withMethods([HTTP_METHOD.GET, HTTP_METHOD.PATCH])(validatePatchOnly)
);
