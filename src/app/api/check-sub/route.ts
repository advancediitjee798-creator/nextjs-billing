import { eq } from 'drizzle-orm';
import { db, users, subscriptions } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email');

  if (!email) {
    return Response.json({ active: false, error: 'Email is required' }, { status: 400 });
  }

  // Find user
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (!user) {
    return Response.json({ active: false, status: 'no_user' });
  }

  // Check active subscription
  const subscription = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.userId, user.id),
  });

  const isActive = subscription?.status === 'active' || subscription?.status === 'on_trial';

  return Response.json({
    active: isActive,
    status: subscription?.status ?? 'none',
    plan: subscription?.name ?? null,
  });
}
