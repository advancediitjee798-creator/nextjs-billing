import GitHub from "next-auth/providers/github";
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  providers: [GitHub],
  pages: {
    signIn: "/",
  },
} satisfies NextAuthConfig;
