import type { NextApiRequest, NextApiResponse } from 'next';

import Cors from 'cors';

// ----------------------------------------------------------------------

type Middleware = (req: NextApiRequest, res: NextApiResponse, next: (result: any) => void) => void;

const initMiddleware = (middleware: Middleware) => (req: NextApiRequest, res: NextApiResponse) =>
  new Promise<void>((resolve, reject) => {
    middleware(req, res, (result: any) => {
      if (result instanceof Error) {
        return reject(result);
      }

      return resolve();
    });
  });

// ----------------------------------------------------------------------

// You can read more about the available options here: https://github.com/expressjs/cors#configuration-options
const cors = initMiddleware(
  Cors({
      origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

export default cors;
