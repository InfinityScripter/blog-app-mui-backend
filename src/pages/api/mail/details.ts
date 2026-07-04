import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';

import { _mails } from 'src/_mock/_mail';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { mailId } = req.query;

    const mail = _mails.find((_mail) => _mail.id === mailId);

    if (!mail) {
      res.status(HTTP.NOT_FOUND).json({
        message: 'Mail not found!',
      });
      return;
    }

    res.status(HTTP.OK).json({
      mail,
    });
  } catch (error) {
    console.error('[Mail API]: ', error);
    res.status(HTTP.INTERNAL).json({
      message: MSG.INTERNAL,
    });
  }
}
