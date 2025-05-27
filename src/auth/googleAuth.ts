import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { PrismaClient, User } from '@prisma/client';
import { createKanbanBoard } from '@controllers/kanbanController';
import { saveCreatorToSpreadsheet } from '@helper/registeredCreatorSpreadsheet';

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
        const existingUser = await prisma.user.findFirst({
          where: {
            OR: [{ email: profile.emails?.[0].value! }, { googleId: profile.id }],
          },
        });

        const user = await prisma.user.upsert({
          where: {
            id: existingUser?.id || '',
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
          include: {
            Board: true,
          },
        });

        // If a existing user is not found, then create kanban and save to spreadsheet
        if (!existingUser) {
          await createKanbanBoard(user.id, 'creator');

          await saveCreatorToSpreadsheet({
            name: user.name || '',
            email: user.email,
            phoneNumber: user.phoneNumber || '',
            country: user.country || '',
            createdAt: user.createdAt || new Date(),
          }).catch((error) => {
            console.error('Error saving creator to spreadsheet:', error);
          });
        }

        if (!user.Board) {
          await createKanbanBoard(user.id, 'creator');
        }
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
