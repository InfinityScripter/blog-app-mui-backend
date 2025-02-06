// src/pages/api/post/search.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import dbConnect from '../../../lib/db';
import { Post } from '../../../models/Post';
import cors from '../../../utils/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await dbConnect();
    await cors(req, res);
    const { query } = req.query;
    const cleanQuery = (query ? `${query}` : '').toLowerCase().trim();
    let results = [];
    if (cleanQuery === '') {
      results = await Post.find({}).lean();
    } else {
      results = await Post.find({ title: { $regex: cleanQuery, $options: 'i' } }).lean();
    }
    res.status(200).json({ results });
  } catch (error: any) {
    console.error('[Post Search API]: ', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
