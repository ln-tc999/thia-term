import type { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { OAuth2Client } from "google-auth-library"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    // ── Google OAuth ─────────────────────────────────────────
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    // ── Email / Password ─────────────────────────────────────
    CredentialsProvider({
      id: "email-password",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        })

        if (!user?.password) return null

        const valid = await bcrypt.compare(credentials.password, user.password)
        if (!valid) return null

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          walletAddress: user.walletAddress ?? null,
          walletType: user.walletType ?? null,
        }
      },
    }),

    // ── Google One Tap ───────────────────────────────────────
    CredentialsProvider({
      id: "google-one-tap",
      name: "Google One Tap",
      credentials: { credential: { type: "text" } },
      async authorize(credentials) {
        if (!credentials?.credential) return null

        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
        const ticket = await client.verifyIdToken({
          idToken: credentials.credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        })
        const payload = ticket.getPayload()
        if (!payload?.email) return null

        let user = await prisma.user.findUnique({ where: { email: payload.email } })
        if (!user) {
          user = await prisma.user.create({
            data: {
              email: payload.email,
              name: payload.name ?? "",
              emailVerified: new Date(),
            },
          })
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          walletAddress: user.walletAddress ?? null,
        }
      },
    }),

  ],

  session: {
    strategy: "jwt",
  },

  callbacks: {
    async jwt({ token, user, account, trigger, session }) {
      if (user) {
        token.id = user.id
        token.picture = user.image ?? null
        const walletFromUser = user.walletAddress ?? null
        if (walletFromUser) {
          // Credentials providers (email/password, siwe, google-one-tap) include walletAddress
          token.walletAddress = walletFromUser
          token.walletType = user.walletType ?? null
        } else {
          // Google OAuth does not include custom fields — always fetch from DB so
          // the wallet address is never lost on re-login.
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { walletAddress: true, walletType: true },
          })
          token.walletAddress = dbUser?.walletAddress ?? null
          token.walletType = dbUser?.walletType ?? null
          // TODO: Re-enable after isDemo migration is deployed to production
          token.isDemo = false
        }
      }
      // Handle session.update() calls from the client
      if (trigger === 'update') {
        if (session?.walletAddress !== undefined) token.walletAddress = session.walletAddress
        if (session?.walletType !== undefined) token.walletType = session.walletType
        if (session?.isDemo !== undefined) token.isDemo = session.isDemo
        if (session?.name !== undefined) token.name = session.name
        if (session?.picture !== undefined) token.picture = session.picture
      }
      return token
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.walletAddress = token.walletAddress as string | null
        session.user.walletType = token.walletType as string | null
        session.user.isDemo = token.isDemo as boolean
        if (token.name) session.user.name = token.name as string
        if (token.picture) session.user.image = token.picture as string
      }
      return session
    },
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },
}
