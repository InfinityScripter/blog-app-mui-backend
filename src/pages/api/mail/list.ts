import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';

import { _mails, _labels } from 'src/_mock/_mail';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { labelId } = req.query;

    const labelInvalid = _labels.map((label) => label.id).includes(`${labelId}`);

    if (!labelInvalid) {
      res.status(HTTP.NOT_FOUND).json({
        message: 'Label not found!',
      });
      return;
    }

    const customLabels = _labels.filter((label) => label.type === 'custom');

    const customLabelIds = customLabels.map((label) => label.id);

    let filtered = [];

    if (labelId && customLabelIds.includes(`${labelId}`)) {
      filtered = _mails.filter((mail) => mail.labelIds.includes(`${labelId}`));
    } else {
      switch (labelId) {
        case undefined:
        case 'inbox':
          filtered = _mails.filter((mail) => mail.folder === 'inbox');
          break;
        case 'all':
          filtered = _mails;
          break;
        case 'starred':
          filtered = _mails.filter((mail) => mail.isStarred);
          break;
        case 'important':
          filtered = _mails.filter((mail) => mail.isImportant);
          break;
        default:
          filtered = _mails.filter((mail) => mail.folder === labelId);
      }
    }

    res.status(HTTP.OK).json({
      mails: filtered,
    });
  } catch (error) {
    console.error('[Mail API]: ', error);
    res.status(HTTP.INTERNAL).json({
      message: MSG.INTERNAL,
    });
  }
}
