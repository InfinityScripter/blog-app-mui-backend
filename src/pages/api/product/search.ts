import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';

import { _products } from 'src/_mock/_product';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { query } = req.query;

    const cleanQuery = `${query}`.toLowerCase().trim();

    const results: typeof _products = [];

    _products.forEach((product) => {
      if (!query) {
        return results.push(product);
      }

      if (product.name.toLowerCase().includes(cleanQuery)) {
        return results.push(product);
      }

      return results;
    });

    res.status(HTTP.OK).json({
      results,
    });
  } catch (error) {
    console.error('[Product API]: ', error);
    res.status(HTTP.INTERNAL).json({
      message: MSG.INTERNAL,
    });
  }
}
