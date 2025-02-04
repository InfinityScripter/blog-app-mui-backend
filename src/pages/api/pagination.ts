import type { NextApiRequest, NextApiResponse } from 'next';

import cors from 'src/utils/cors';

// ----------------------------------------------------------------------

const _products = [...Array(100)].map((_, index) => ({
  id: `id-${index + 1}`,
  name: `product-${index + 1}`,
}));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await cors(req, res);

    const currentPage = Number(req.query.page) + 1;
    const perPage = Number(req.query.perPage);
    const startIndex = (currentPage - 1) * perPage;
    const endIndex = startIndex + perPage;

    const products = _products.slice(startIndex, endIndex);
    const totalPages = _products.length;

    res.status(200).json({
      products,
      totalPages,
    });
  } catch (error) {
    console.error('[Pagination API]: ', error);
    res.status(500).json({
      message: 'Internal server error',
    });
  }
}
