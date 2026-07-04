import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP } from '@/src/constants/http';
import { MSG } from '@/src/constants/messages';

import { _products } from 'src/_mock/_product';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { productId } = req.query;

    const product = _products.find((_product) => _product.id === productId);

    if (!product) {
      res.status(HTTP.NOT_FOUND).json({
        message: 'Product not found!',
      });
      return;
    }

    res.status(HTTP.OK).json({
      product,
    });
  } catch (error) {
    console.error('[Product API]: ', error);
    res.status(HTTP.INTERNAL).json({
      message: MSG.INTERNAL,
    });
  }
}
