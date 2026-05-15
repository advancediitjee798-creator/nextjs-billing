import { eq } from 'drizzle-orm';
import { db, users } from '@/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email');

  if (!email) {
    return Response.json({ error: 'Email is required' }, { status: 400 });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  return Response.json({ premium: Boolean(user?.subscribed) });
}