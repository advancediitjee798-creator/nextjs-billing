/* eslint-disable no-console -- allow logs */
/* eslint-disable @typescript-eslint/no-non-null-assertion -- checked in configureLemonSqueezy() */
"use server";

import crypto from "node:crypto";
import {
  cancelSubscription,
  createCheckout,
  createWebhook,
  getPrice,
  getProduct,
  getSubscription,
  listPrices,
  listProducts,
  listWebhooks,
  updateSubscription,
  type Variant,
} from "@lemonsqueezy/lemonsqueezy.js";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import {
  db,
  plans,
  subscriptions,
  webhookEvents,
  singlePurchases,
  users,
  type NewPlan,
  type NewSubscription,
  type NewWebhookEvent,
} from "@/db/schema";
import { configureLemonSqueezy } from "@/config/lemonsqueezy";
import { webhookHasData, webhookHasMeta } from "@/lib/typeguards";
import { takeUniqueOrThrow } from "@/lib/utils";
import { auth, signOut } from "../auth";

export async function logout() {
  await signOut();
}

export async function getCheckoutURL(variantId: number, embed = false) {
  configureLemonSqueezy();

  const session = await auth();

  if (!session?.user) {
    throw new Error("User is not authenticated.");
  }

  const checkout = await createCheckout(
    process.env.LEMONSQUEEZY_STORE_ID!,
    variantId,
    {
      checkoutOptions: {
        embed,
        media: false,
        logo: !embed,
      },
      checkoutData: {
        email: session.user.email ?? undefined,
        custom: {
          user_id: session.user.id,
        },
      },
      productOptions: {
        enabledVariants: [variantId],
        redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/billing/`,
        receiptButtonText: "Go to Dashboard",
        receiptThankYouNote: "Thank you for signing up to Lemon Stand!",
      },
    },
  );

  return checkout.data?.data.attributes.url;
}

export async function hasWebhook() {
  configureLemonSqueezy();

  if (!process.env.WEBHOOK_URL) {
    throw new Error(
      "Missing required WEBHOOK_URL env variable. Please, set it in your .env file.",
    );
  }

  const allWebhooks = await listWebhooks({
    filter: { storeId: process.env.LEMONSQUEEZY_STORE_ID },
  });

  let webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl.endsWith("/")) {
    webhookUrl += "/";
  }
  webhookUrl += "api/webhook";

  const webhook = allWebhooks.data?.data.find(
    (wh) => wh.attributes.url === webhookUrl && wh.attributes.test_mode,
  );

  revalidatePath("/");

  return webhook;
}

export async function setupWebhook() {
  configureLemonSqueezy();

  if (!process.env.WEBHOOK_URL) {
    throw new Error(
      "Missing required WEBHOOK_URL env variable. Please, set it in your .env file.",
    );
  }

  let webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl.endsWith("/")) {
    webhookUrl += "/";
  }
  webhookUrl += "api/webhook";

  let webhook = await hasWebhook();

  if (!webhook) {
    const newWebhook = await createWebhook(process.env.LEMONSQUEEZY_STORE_ID!, {
      secret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET!,
      url: webhookUrl,
      testMode: true,
      events: [
        "subscription_created",
        "subscription_expired",
        "subscription_updated",
        "order_created",
      ],
    });

    webhook = newWebhook.data?.data;
  }

  revalidatePath("/");
}

export async function syncPlans() {
  configureLemonSqueezy();

  const productVariants: NewPlan[] = await db.select().from(plans);

  async function _addVariant(variant: NewPlan) {
    await db
      .insert(plans)
      .values(variant)
      .onConflictDoUpdate({ target: plans.variantId, set: variant });

    productVariants.push(variant);
  }

  const products = await listProducts({
    filter: { storeId: process.env.LEMONSQUEEZY_STORE_ID },
    include: ["variants"],
  });

  const allVariants = products.data?.included as Variant["data"][] | undefined;

  if (allVariants) {
    for (const v of allVariants) {
      const variant = v.attributes;

      if (
        variant.status === "draft" ||
        (allVariants.length !== 1 && variant.status === "pending")
      ) {
        continue;
      }

      const productName =
        (await getProduct(variant.product_id)).data?.data.attributes.name ?? "";

      const variantPriceObject = await listPrices({
        filter: { variantId: v.id },
      });

      const currentPriceObj = variantPriceObject.data?.data.at(0);
      const isUsageBased =
        currentPriceObj?.attributes.usage_aggregation !== null;
      const interval = currentPriceObj?.attributes.renewal_interval_unit;
      const intervalCount =
        currentPriceObj?.attributes.renewal_interval_quantity;
      const trialInterval = currentPriceObj?.attributes.trial_interval_unit;
      const trialIntervalCount =
        currentPriceObj?.attributes.trial_interval_quantity;

      const price = isUsageBased
        ? currentPriceObj?.attributes.unit_price_decimal
        : currentPriceObj.attributes.unit_price;

      const priceString = price !== null ? (price?.toString() ?? "") : "";

      const isSubscription =
        currentPriceObj?.attributes.category === "subscription";

      if (!isSubscription) {
        continue;
      }

      await _addVariant({
        name: variant.name,
        description: variant.description,
        price: priceString,
        interval,
        intervalCount,
        isUsageBased,
        productId: variant.product_id,
        productName,
        variantId: parseInt(v.id) as unknown as number,
        trialInterval,
        trialIntervalCount,
        sort: variant.sort,
      });
    }
  }

  revalidatePath("/");

  return productVariants;
}

export async function storeWebhookEvent(
  eventName: string,
  body: NewWebhookEvent["body"],
) {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not set");
  }

  const id = crypto.randomInt(100000000, 1000000000);

  const returnedValue = await db
    .insert(webhookEvents)
    .values({
      eventName,
      processed: false,
      body,
    })
    .onConflictDoNothing({ target: plans.id })
    .returning();

  return returnedValue[0];
}

export async function processWebhookEvent(webhookEvent: NewWebhookEvent) {
  configureLemonSqueezy();

  const dbwebhookEvent = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, webhookEvent.id ?? 0));

  if (dbwebhookEvent.length < 1) {
    throw new Error(
      `Webhook event #${webhookEvent.id} not found in the database.`,
    );
  }

  if (!process.env.WEBHOOK_URL) {
    throw new Error(
      "Missing required WEBHOOK_URL env variable. Please, set it in your .env file.",
    );
  }

  let processingError = "";
  const eventBody = webhookEvent.body;

  if (!webhookHasMeta(eventBody)) {
    processingError = "Event body is missing the 'meta' property.";
  } else if (webhookHasData(eventBody)) {
    if (webhookEvent.eventName.startsWith("subscription_payment_")) {
      // Not implemented.
    } else if (webhookEvent.eventName.startsWith("subscription_")) {
      const attributes = eventBody.data.attributes;
      const variantId = attributes.variant_id as string;

      const plan = await db
        .select()
        .from(plans)
        .where(eq(plans.variantId, parseInt(variantId, 10)));

      if (plan.length < 1) {
        processingError = `Plan with variantId ${variantId} not found.`;
      } else {
        const priceId = attributes.first_subscription_item.price_id;

        const priceData = await getPrice(priceId);
        if (priceData.error) {
          processingError = `Failed to get the price data for the subscription ${eventBody.data.id}.`;
        }

        const isUsageBased = attributes.first_subscription_item.is_usage_based;
        const price = isUsageBased
          ? priceData.data?.data.attributes.unit_price_decimal
          : priceData.data?.data.attributes.unit_price;

        const updateData: NewSubscription = {
          lemonSqueezyId: eventBody.data.id,
          orderId: attributes.order_id as number,
          name: attributes.user_name as string,
          email: attributes.user_email as string,
          status: attributes.status as string,
          statusFormatted: attributes.status_formatted as string,
          renewsAt: attributes.renews_at as string,
          endsAt: attributes.ends_at as string,
          trialEndsAt: attributes.trial_ends_at as string,
          price: price?.toString() ?? "",
          isPaused: false,
          subscriptionItemId: attributes.first_subscription_item.id,
          isUsageBased: attributes.first_subscription_item.is_usage_based,
          userId: eventBody.meta.custom_data.user_id,
          planId: plan[0].id,
        };

        try {
          await db.insert(subscriptions).values(updateData).onConflictDoUpdate({
            target: subscriptions.lemonSqueezyId,
            set: updateData,
          });
        } catch (error) {
          processingError = `Failed to upsert Subscription #${updateData.lemonSqueezyId} to the database.`;
          console.error(error);
        }
      }
    } else if (webhookEvent.eventName.startsWith("order_")) {
      const attributes = eventBody.data.attributes as Record<string, any>;
      const variantId = attributes.first_order_item?.variant_id;
      const userEmail = attributes.user_email as string;
      const slug = attributes.custom_data?.slug as string | undefined;

      const SINGLE_VARIANT = Number(process.env.SINGLE_PURCHASE_VARIANT_ID);

      if (variantId === SINGLE_VARIANT && slug && userEmail) {
        const user = await db.query.users.findFirst({
          where: eq(users.email, userEmail),
        });

        if (user) {
          await db.insert(singlePurchases).values({
            userId: user.id,
            writeupSlug: slug,
            lemonSqueezyOrderId: String(eventBody.data.id),
          });
        } else {
          processingError = `User with email ${userEmail} not found for single purchase.`;
        }
      }
    } else if (webhookEvent.eventName.startsWith("license_")) {
      // Not implemented.
    }

    await db
      .update(webhookEvents)
      .set({
        processed: true,
        processingError,
      })
      .where(eq(webhookEvents.id, webhookEvent.id ?? 0));
  }
}

export async function getUserSubscriptions() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    notFound();
  }

  const userSubscriptions: NewSubscription[] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId));

  revalidatePath("/");

  return userSubscriptions;
}

export async function getSubscriptionURLs(id: string) {
  configureLemonSqueezy();
  const subscription = await getSubscription(id);

  if (subscription.error) {
    throw new Error(subscription.error.message);
  }

  revalidatePath("/");

  return subscription.data.data.attributes.urls;
}

export async function cancelSub(id: string) {
  configureLemonSqueezy();

  const userSubscriptions = await getUserSubscriptions();

  const subscription = userSubscriptions.find(
    (sub) => sub.lemonSqueezyId === id,
  );

  if (!subscription) {
    throw new Error(`Subscription #${id} not found.`);
  }

  const cancelledSub = await cancelSubscription(id);

  if (cancelledSub.error) {
    throw new Error(cancelledSub.error.message);
  }

  try {
    await db
      .update(subscriptions)
      .set({
        status: cancelledSub.data.data.attributes.status,
        statusFormatted: cancelledSub.data.data.attributes.status_formatted,
        endsAt: cancelledSub.data.data.attributes.ends_at,
      })
      .where(eq(subscriptions.lemonSqueezyId, id));
  } catch (error) {
    throw new Error(`Failed to cancel Subscription #${id} in the database.`);
  }

  revalidatePath("/");

  return cancelledSub;
}

export async function pauseUserSubscription(id: string) {
  configureLemonSqueezy();

  const userSubscriptions = await getUserSubscriptions();

  const subscription = userSubscriptions.find(
    (sub) => sub.lemonSqueezyId === id,
  );

  if (!subscription) {
    throw new Error(`Subscription #${id} not found.`);
  }

  const returnedSub = await updateSubscription(id, {
    pause: { mode: "void" },
  });

  try {
    await db
      .update(subscriptions)
      .set({
        status: returnedSub.data?.data.attributes.status,
        statusFormatted: returnedSub.data?.data.attributes.status_formatted,
        endsAt: returnedSub.data?.data.attributes.ends_at,
        isPaused: returnedSub.data?.data.attributes.pause !== null,
      })
      .where(eq(subscriptions.lemonSqueezyId, id));
  } catch (error) {
    throw new Error(`Failed to pause Subscription #${id} in the database.`);
  }

  revalidatePath("/");

  return returnedSub;
}

export async function unpauseUserSubscription(id: string) {
  configureLemonSqueezy();

  const userSubscriptions = await getUserSubscriptions();

  const subscription = userSubscriptions.find(
    (sub) => sub.lemonSqueezyId === id,
  );

  if (!subscription) {
    throw new Error(`Subscription #${id} not found.`);
  }

  const returnedSub = await updateSubscription(id, { pause: null });

  try {
    await db
      .update(subscriptions)
      .set({
        status: returnedSub.data?.data.attributes.status,
        statusFormatted: returnedSub.data?.data.attributes.status_formatted,
        endsAt: returnedSub.data?.data.attributes.ends_at,
        isPaused: returnedSub.data?.data.attributes.pause !== null,
      })
      .where(eq(subscriptions.lemonSqueezyId, id));
  } catch (error) {
    throw new Error(`Failed to unpause Subscription #${id} in the database.`);
  }

  revalidatePath("/");

  return returnedSub;
}

export async function changePlan(currentPlanId: number, newPlanId: number) {
  configureLemonSqueezy();

  const userSubscriptions = await getUserSubscriptions();

  const subscription = userSubscriptions.find(
    (sub) => sub.planId === currentPlanId,
  );

  if (!subscription) {
    throw new Error(
      `No subscription with plan id #${currentPlanId} was found.`,
    );
  }

  const newPlan = await db
    .select()
    .from(plans)
    .where(eq(plans.id, newPlanId))
    .then(takeUniqueOrThrow);

  const updatedSub = await updateSubscription(subscription.lemonSqueezyId, {
    variantId: newPlan.variantId,
  });

  try {
    await db
      .update(subscriptions)
      .set({
        planId: newPlanId,
        price: newPlan.price,
        endsAt: updatedSub.data?.data.attributes.ends_at,
      })
      .where(eq(subscriptions.lemonSqueezyId, subscription.lemonSqueezyId));
  } catch (error) {
    throw new Error(
      `Failed to update Subscription #${subscription.lemonSqueezyId} in the database.`,
    );
  }

  revalidatePath("/");

  return updatedSub;
}
