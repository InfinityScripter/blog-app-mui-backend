import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { requireAuth } from '@/src/utils/auth';
import { requireAdmin } from '@/src/utils/admin';
import { HTTP_METHOD } from '@/src/constants/http';
import { sendDigestEmail } from '@/src/utils/email';
import { validateBody } from '@/src/utils/validate';
import { ok, sendError } from '@/src/utils/response';
import { emitAudit } from '@/src/utils/audit-context';
import { sendDigestSchema } from '@/src/schemas/newsletter';
import { withMethods } from '@/src/middlewares/with-methods';
import { subscriberService } from '@/src/services/subscriber';

// Admin/bot-only POST. Bot auth is the requireAuth freebie (Bearer BOT_API_TOKEN
// → OWNER_EMAIL admin). Sends the digest to every CONFIRMED subscriber; each
// email carries a per-recipient unsubscribe footer. Responds 200 with ok()
// envelope — the bot reads data.data.sent / data.data.failed.
async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    const { subject, html } = req.body;
    const recipients = await subscriberService.listConfirmed();

    const results = await Promise.allSettled(
      recipients.map((recipient) =>
        sendDigestEmail(recipient.email, subject, html, recipient.unsubscribeToken)
      )
    );

    const sent = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - sent;

    emitAudit(req, {
      action: 'newsletter.sent',
      targetType: 'newsletter',
      metadata: { sent, failed },
    });

    return ok(res, { sent, failed });
  } catch (error) {
    return sendError(res, error);
  }
}

export default requireAuth(
  requireAdmin(withMethods([HTTP_METHOD.POST])(validateBody(sendDigestSchema)(handler)))
);
