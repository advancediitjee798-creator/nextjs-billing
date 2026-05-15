// app/api/webhook/route.ts
import crypto from 'node:crypto';
import { lemonSqueezySetup } from '@lemonsqueezy/lemonsqueezy.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifySignature(rawBody: string, signature: string): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '';
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

interface LemonSqueezyPayload {
  meta: {
    event_name: string;
  };
}

export async function POST(req: Request) {
  lemonSqueezySetup({
    apiKey: process.env.LEMONSQUEEZY_API_KEY ?? '',
  });

  const rawBody = await req.text();
  const signature = req.headers.get('x-signature') ?? '';

  if (!verifySignature(rawBody, signature)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const payload = JSON.parse(rawBody) as LemonSqueezyPayload;
  const eventName = payload.meta.event_name;

  switch (eventName) {
    case 'order_created':
      // handle order
      break;
    case 'subscription_created':
      // handle subscription
      break;
    default:
      break;
  }

  return new Response('OK', { status: 200 });
}