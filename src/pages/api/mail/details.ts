import type { NextApiRequest, NextApiResponse } from 'next';

import cors from 'src/utils/cors';

import { _mails } from 'src/_mock/_mail';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await cors(req, res);

    const { mailId } = req.query;

    const mail = _mails.find((_mail) => _mail.id === mailId);

    if (!mail) {
      res.status(404).json({
        message: 'Mail not found!',
      });
      return;
    }

    res.status(200).json({
      mail,
    });
  } catch (error) {
    console.error('[Mail API]: ', error);
    res.status(500).json({
      message: 'Internal server error',
    });
  }
}
