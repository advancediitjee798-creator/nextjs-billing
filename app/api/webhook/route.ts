// app/api/webhook/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { lemonSqueezySetup, webhooks } from '@lemonsqueezy/lemonsqueezy.js';

export async function POST(req: Request) {
  lemonSqueezySetup({
    apiKey: process.env.LEMONSQUEEZY_API_KEY!,
  });

  const rawBody = await req.text();
  const signature = req.headers.get('x-signature') ?? '';

  // your verification + handling logic
}
