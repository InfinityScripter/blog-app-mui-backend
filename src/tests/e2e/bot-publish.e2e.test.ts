import type { AddressInfo } from 'node:net';

import '@jest/globals';
import bcrypt from 'bcrypt';
import http from 'node:http';
import User from '@/src/models/User';
import { Post } from '@/src/models/Post';
import { HTTP_METHOD } from '@/src/constants/http';
import newPostHandler from '@/src/pages/api/post/new';
import { apiResolver } from 'next/dist/server/api-utils/node/api-resolver';

// Live end-to-end test of the bot → blog publish path. Unlike the unit test
// (node-mocks-http, in-process handler call), this spins up a REAL HTTP server
// that runs the route exactly as Next does — via apiResolver — and sends a real
// network request carrying the BOT_API_TOKEN. It proves the full server-side
// chain over the wire: requireAuth's service-token branch → owner lookup by
// OWNER_EMAIL → createPost → 201 authored by the owner. pg-mem (NODE_ENV=test)
// backs the DB in the same process, so the seeded owner is visible to the
// handler. The bot's own publisher is covered separately by its unit test that
// asserts the exact request shape this server validates.

const BOT_TOKEN = 'e2e_bot_service_token_value';
const OWNER_EMAIL = 'e2e-owner@example.com';

/** Mounts the post/new route on a real HTTP server, exactly as Next runs it. */
function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    apiResolver(
      req,
      res,
      {}, // query
      newPostHandler,
      {
        previewModeId: 'test',
        previewModeEncryptionKey: 'test',
        previewModeSigningKey: 'test',
      } as never,
      false, // propagateError
      false, // dev
      '/api/post/new' // page
    ).catch((err: unknown) => {
      // apiResolver writes its own error response; surface unexpected throws.
      // eslint-disable-next-line no-console
      console.error('[e2e] apiResolver threw:', err);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/api/post/new`,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

describe('E2E: bot publishes to the blog over HTTP with BOT_API_TOKEN', () => {
  const ORIGINAL_ENV = { ...process.env };
  let server: { url: string; close: () => Promise<void> };

  beforeEach(async () => {
    process.env.BOT_API_TOKEN = BOT_TOKEN;
    process.env.OWNER_EMAIL = OWNER_EMAIL;

    const passwordHash = await bcrypt.hash('ownerpassword', 10);
    await User.create({
      name: 'E2E Owner',
      email: OWNER_EMAIL,
      passwordHash,
      avatarURL: 'http://example.com/owner.jpg',
      role: 'admin',
    });

    server = await startServer();
  });

  afterEach(async () => {
    await server.close();
    process.env.BOT_API_TOKEN = ORIGINAL_ENV.BOT_API_TOKEN;
    process.env.OWNER_EMAIL = ORIGINAL_ENV.OWNER_EMAIL;
  });

  /** The exact body the bot's publisher sends (see ai-bot-tg toBlogPostBody). */
  const botBody = {
    title: 'E2E новость',
    description: 'Краткое резюме новости',
    content: '# Тело\n\nАбзац. Источник: Feed',
    tags: ['новости', 'тест'],
    metaTitle: 'E2E новость',
    metaDescription: 'SEO описание',
    metaKeywords: ['новости', 'тест'],
    publish: 'published',
  };

  it('creates a published post authored by the owner (201) over the wire', async () => {
    const res = await fetch(server.url, {
      method: HTTP_METHOD.POST,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BOT_TOKEN}`,
      },
      body: JSON.stringify(botBody),
    });

    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      success: boolean;
      post: { _id: string; author: { name: string }; publish: string };
    };
    expect(data.success).toBe(true);
    expect(data.post.author.name).toBe('E2E Owner');
    expect(data.post.publish).toBe('published');

    // Confirm it actually landed in the DB as the owner's post.
    const saved = await Post.findById(data.post._id);
    expect(saved?.title).toBe('E2E новость');
  });

  it('rejects a wrong bot token over the wire (401)', async () => {
    const res = await fetch(server.url, {
      method: HTTP_METHOD.POST,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token-over-the-wire-aaaaaaaaaa',
      },
      body: JSON.stringify(botBody),
    });
    expect(res.status).toBe(401);
  });
});
