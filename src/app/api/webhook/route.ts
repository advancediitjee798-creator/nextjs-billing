import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.POSTGRES_URL!);

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  subscribed: boolean("subscribed").notNull().default(false),
  lemonSqueezyCustomerId: text("lemonSqueezyCustomerId"),
  lemonSqueezySubscriptionId: text("lemonSqueezySubscriptionId"),
});

export const accounts = pgTable("account", {
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("providerAccountId").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: timestamp("expires_at", { mode: "date" }),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verificationToken", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const plans = pgTable("plan", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  productId: integer("productId").notNull(),
  productName: text("productName"),
  variantId: integer("variantId").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  price: text("price").notNull(),
  isUsageBased: boolean("isUsageBased").default(false),
  interval: text("interval"),
  intervalCount: integer("intervalCount"),
  trialInterval: text("trialInterval"),
  trialIntervalCount: integer("trialIntervalCount"),
  sort: integer("sort"),
});

export const subscriptions = pgTable("subscription", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  lemonSqueezyId: text("lemonSqueezyId").unique().notNull(),
  orderId: integer("orderId").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  status: text("status").notNull(),
  statusFormatted: text("statusFormatted").notNull(),
  renewsAt: text("renewsAt"),
  endsAt: text("endsAt"),
  trialEndsAt: text("trialEndsAt"),
  price: text("price").notNull(),
  isUsageBased: boolean("isUsageBased").default(false),
  isPaused: boolean("isPaused").default(false),
  subscriptionItemId: integer("subscriptionItemId"),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: integer("planId").notNull().references(() => plans.id, { onDelete: "restrict" }),
});

export const webhookEvents = pgTable("webhookEvent", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  eventName: text("eventName").notNull(),
  processed: boolean("processed").default(false),
  body: text("body").notNull(),
  processingError: text("processingError"),
});

export type NewPlan = typeof plans.$inferInsert;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;

export const db = drizzle(sql, {
  schema: { users, accounts, sessions, verificationTokens, plans, subscriptions, webhookEvents },
});