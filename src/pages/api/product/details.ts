import type { NextApiRequest, NextApiResponse } from 'next';

import cors from 'src/utils/cors';

import { _products } from 'src/_mock/_product';

// ----------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await cors(req, res);

    const { productId } = req.query;

    const product = _products.find((_product) => _product.id === productId);

    if (!product) {
      res.status(404).json({
        message: 'Product not found!',
      });
      return;
    }

    res.status(200).json({
      product,
    });
  } catch (error) {
    console.error('[Product API]: ', error);
    res.status(500).json({
      message: 'Internal server error',
    });
  }
}
