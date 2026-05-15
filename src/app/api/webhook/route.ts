import crypto from "node:crypto";
import { processWebhookEvent, storeWebhookEvent } from "@/app/actions";
import { webhookHasMeta } from "@/lib/typeguards";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.LEMONSQUEEZY_WEBHOOK_SECRET) {
    return new Response("Lemon Squeezy Webhook Secret not set in .env", {
      status: 500,
    });
  }

  const rawBody = await request.text();
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  const hmac = crypto.createHmac("sha256", secret);
  const digest = Uint8Array.from(
  Buffer.from(hmac.update(rawBody).digest("hex"), "utf8")
);
const signature = Uint8Array.from(
  Buffer.from(request.headers.get("x-signature") ?? "", "utf8")
);

if (!crypto.timingSafeEqual(digest, signature)) {
  return new Response("Invalid signature", { status: 400 });
}

  const data = JSON.parse(rawBody) as unknown;

  if (webhookHasMeta(data)) {
    const webhookEvent = await storeWebhookEvent(data.meta.event_name, rawBody);
    void processWebhookEvent(webhookEvent);
    return new Response("OK", { status: 200 });
  }

  return new Response("Data invalid", { status: 400 });
}