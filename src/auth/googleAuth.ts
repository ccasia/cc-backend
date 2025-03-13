import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: `${process.env.BACKEND_URL}/api/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user exists
        let user = await prisma.user.findFirst({
          where: {
            OR: [{ email: profile.emails?.[0].value! }, { googleId: profile.id }],
          },
        });

        user = await prisma.user.upsert({
          where: {
            id: user?.id || '',
          },
          update: {
            googleId: profile.id,
            photoURL: profile.photos?.[0]?.value || '',
          },
          create: {
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails?.[0]?.value || '',
            photoURL: profile.photos?.[0]?.value || '',
            role: 'creator',
            status: 'active',
            creator: {
              create: {},
            },
          },
        });

        return done(null, user);
      } catch (err) {
        return done(err, null!);
      }
    },
  ),
);

// Serialize user for session
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  const user = await prisma.user.findUnique({ where: { id } });
  done(null, user);
});

export default passport;
