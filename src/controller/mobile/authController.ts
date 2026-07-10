import { prisma } from '@/src/prisma/prisma';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma, Employment } from '@prisma/client';
import jwt, { Secret } from 'jsonwebtoken';
import { generateRandomString } from '@/src/utils/randomString';
import dayjs from 'dayjs';
import { creatorVerificationEmail, mobileCreatorVerificationEmail } from '@/src/config/nodemailer.config';
import { uploadProfileImage } from '@/src/config/cloudStorage.config';
import { handleChangePassword } from '@/src/service/authServices';
import { z } from 'zod';
import { getRefreshTokenExpiryDate, hashToken, verifyRefreshToken } from '@/src/utils/tokens';
import { delay } from 'bullmq';
import appleSignin from 'apple-signin-auth';
import crypto from 'crypto';
import { createKanbanBoard } from '../kanbanController';
import { saveCreatorToSpreadsheet } from '@/src/helper/registeredCreatorSpreadsheet';
import { exchangeAppleRefreshToken, revokeAppleToken } from '@/src/utils/apple';

interface MobileCreatorData {
  phone?: string;
  Nationality?: string;
  state?: string;
  city?: string;
  pronounce?: string;
  birthDate?: string | null;
  employment?: string;
  languages?: string[];
  interests?: (string | { name: string })[];
  instagram?: string;
  tiktok?: string;
  instagramProfileLink?: string;
  tiktokProfileLink?: string;
  location?: string;
  referralCode?: string;
}

const generateNumericCode = (length = 6): string =>
  crypto
    .randomInt(0, 10 ** length)
    .toString()
    .padStart(length, '0');

const isEmployment = (value?: string): value is Employment =>
  value != null && (Object.values(Employment) as string[]).includes(value);

export const login = async (
  req: Request<{}, {}, { email: string; password: string; ipAddress: string; userAgent: string }>,
  res: Response,
) => {
  const { email, password, ipAddress, userAgent } = req.body;

  try {
    // Validation checking on server
    if (!email.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/g)) {
      return res.status(400).json({ message: 'Please enter the correct email format', success: false });
    }

    const user = await prisma.user.findFirst({
      where: {
        email: {
          mode: 'insensitive',
          equals: email,
        },
      },
    });

    if (!user) return res.status(404).json({ message: 'User not found', success: false });

    switch (user.status) {
      case 'banned':
        return res.status(400).json({ message: 'Account banned.' });
      case 'pending':
        return res.status(400).json({ message: 'Account pending.' });
      case 'blacklisted':
        return res.status(400).json({ message: 'Account blacklisted.' });
      case 'suspended':
        return res.status(400).json({ message: 'Account suspended.' });
      case 'spam':
        return res.status(400).json({ message: 'Account spam.' });
      case 'rejected':
        return res.status(400).json({ message: 'Account rejected.' });
      case 'deleted':
        return res.status(400).json({ message: 'Account not found.' });
    }

    const isMatch = await bcrypt.compare(password, user.password as string);

    if (!isMatch) {
      return res.status(404).json({ message: 'Wrong password' });
    }

    const accessToken = jwt.sign({ userId: user.id, email: user.email }, process.env.ACCESSKEY!, { expiresIn: '1m' });
    const refreshToken = jwt.sign({ userId: user.id, email: user.email }, process.env.REFRESHKEY!, {
      expiresIn: '30d',
    });

    const savedRefreshToken = await prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        userId: user.id,
        expiresAt: dayjs().add(30, 'days').toDate(),
        ipAddress,
        userAgent,
      },
    });

    return res.status(200).json({ user, token: { accessToken, refreshToken } });
  } catch (err) {
    console.log(err);
    return res.status(500).json(err);
  }
};

export const register = async (
  req: Request<{}, {}, { name: string; email: string; password: string; creatorData?: MobileCreatorData }>,
  res: Response,
) => {
  const { name, email, password, creatorData } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
  }

  if (!email.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
    return res.status(400).json({ success: false, message: 'Please enter the correct email format' });
  }

  // Mirror web yup validation (cc-frontend src/sections/creator/form/creatorForm.jsx:88-126).
  if (creatorData) {
    const missing: string[] = [];
    if (!creatorData.Nationality) missing.push('Nationality');
    if (!creatorData.city && !creatorData.state) missing.push('city or state');
    if (!creatorData.phone || creatorData.phone.trim().length < 7) missing.push('phone');
    if (!creatorData.pronounce) missing.push('pronounce');
    if (!creatorData.birthDate) missing.push('birthDate');
    if (!creatorData.languages || creatorData.languages.length < 1) missing.push('languages (min 1)');
    if (!creatorData.interests || creatorData.interests.length < 3) missing.push('interests (min 3)');
    const hasSocial =
      (creatorData.instagramProfileLink && creatorData.instagramProfileLink.trim().length > 0) ||
      (creatorData.tiktokProfileLink && creatorData.tiktokProfileLink.trim().length > 0);
    if (!hasSocial) missing.push('instagramProfileLink or tiktokProfileLink');
    if (missing.length > 0) {
      return res.status(400).json({ success: false, message: `Missing required fields: ${missing.join(', ')}` });
    }
  }

  try {
    const normalizedEmail = email.toLowerCase();

    const existing = await prisma.user.findFirst({
      where: { email: { mode: 'insensitive', equals: normalizedEmail } },
    });

    // 'deleted' rows are soft-deleted archives whose data must survive — never
    // let them fall through to the cleanup delete below.
    if (existing?.status === 'active' || existing?.status === 'deleted') {
      return res.status(409).json({ success: false, message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const { user, shortCode } = await prisma.$transaction(async (tx) => {
      // Abandoned, unverified attempt for this email — wipe it so this one starts clean.
      // Requires onDelete: Cascade from creator / interest / emailVerification -> user.
      if (existing && existing.status !== 'active') {
        await tx.user.delete({ where: { id: existing.id } });
      }

      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          role: 'creator',
          name,
          phoneNumber: creatorData?.phone || '',
          country: creatorData?.Nationality || '',
          city: creatorData?.city || creatorData?.state || '',
          referralCode: creatorData?.referralCode || null,
        },
      });

      const creatorObj: Prisma.CreatorUncheckedCreateInput = {
        userId: user.id,
        isOnBoardingFormCompleted: !!creatorData,
      };

      if (creatorData) {
        Object.assign(creatorObj, {
          instagram: creatorData.instagram || '',
          pronounce: creatorData.pronounce || '',
          location: creatorData.location || '',
          birthDate: creatorData.birthDate ? new Date(creatorData.birthDate) : null,
          employment: creatorData.employment || '',
          tiktok: creatorData.tiktok || '',
          languages: creatorData.languages || [],
          instagramProfileLink: creatorData.instagramProfileLink || '',
          tiktokProfileLink: creatorData.tiktokProfileLink || '',
          state: creatorData.state || '',
        });
      }

      await tx.creator.create({ data: creatorObj });

      if (creatorData?.interests && creatorData.interests.length > 0) {
        const interestsToCreate = creatorData.interests.map((interest) => {
          const interestName = typeof interest === 'string' ? interest : interest.name;
          return { name: interestName, userId: user.id };
        });
        await tx.interest.createMany({ data: interestsToCreate });
      }

      const token = jwt.sign({ id: user.id }, process.env.ACCESSKEY as Secret, { expiresIn: '15m' });
      const shortCode = generateNumericCode();

      await tx.emailVerification.create({
        data: {
          shortCode,
          user: { connect: { id: user.id } },
          expiredAt: dayjs().add(15, 'minute').toDate(),
          token,
        },
      });

      return { user, shortCode };
    });

    await createKanbanBoard(user.id, 'creator');

    // Send AFTER commit — never do network I/O inside a transaction.
    try {
      await mobileCreatorVerificationEmail(user.email, shortCode);
    } catch (mailError) {
      console.error('Verification email send failed:', mailError);
      // Account + code exist and are valid; the client can fall back to the resend endpoint.
      return res.status(201).json({
        success: true,
        emailSent: false,
        message: 'Account created but the verification email failed to send. Please resend.',
        email: user.email,
      });
    }

    return res.status(201).json({
      success: true,
      emailSent: true,
      message: 'Verification email sent',
      email: user.email,
    });
  } catch (error) {
    console.error('Mobile creator registration error:', error);
    return res
      .status(400)
      .json({ success: false, message: error instanceof Error ? error.message : 'Error registering creator' });
  }
};

export const updateProfile = async (
  req: Request<
    {},
    {},
    {
      name?: string;
      phone?: string;
      Nationality?: string;
      city?: string;
      pronounce?: string;
      birthDate?: string | null;
      instagramProfileLink?: string;
      tiktokProfileLink?: string;
    }
  >,
  res: Response,
) => {
  // `authenticate` middleware sets req.userId from session OR JWT bearer token
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { name, phone, Nationality, city, pronounce, birthDate, instagramProfileLink, tiktokProfileLink } = req.body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          ...(name !== undefined && { name }),
          ...(phone !== undefined && { phoneNumber: phone }),
          ...(Nationality !== undefined && { country: Nationality }),
          ...(city !== undefined && { city }),
        },
      });

      if (
        updatedUser.role === 'creator' &&
        (pronounce !== undefined ||
          birthDate !== undefined ||
          instagramProfileLink !== undefined ||
          tiktokProfileLink !== undefined)
      ) {
        await tx.creator.update({
          where: { userId },
          data: {
            ...(pronounce !== undefined && { pronounce }),
            ...(birthDate !== undefined && {
              birthDate: birthDate ? new Date(birthDate) : null,
            }),
            ...(instagramProfileLink !== undefined && { instagramProfileLink }),
            ...(tiktokProfileLink !== undefined && { tiktokProfileLink }),
          },
        });
      }

      return updatedUser;
    });

    await createKanbanBoard(result.id, 'creator');

    return res.status(200).json({ success: true, message: 'Profile updated', user: result });
  } catch (error) {
    console.error('Mobile profile update error:', error);
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Update failed' });
  }
};

export const updatePhoto = async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const image = (req.files as any)?.image;
    const remove = req.body?.remove === true || req.body?.remove === 'true';

    if (!image && !remove) {
      return res.status(400).json({ success: false, message: 'No image or remove flag provided' });
    }

    let photoURL: string | null = null;

    if (image) {
      // Prefix with userId so concurrent uploads from different users don't collide in GCS.
      const original = (image.name as string) || 'profile.jpg';
      const ext = original.includes('.') ? original.slice(original.lastIndexOf('.')) : '.jpg';
      const fileName = `${userId}-${Date.now()}${ext}`;
      photoURL = await uploadProfileImage(image.tempFilePath, fileName, 'creator');
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { photoURL },
      select: { id: true, photoURL: true },
    });

    return res.status(200).json({ success: true, photoURL: updated.photoURL });
  } catch (error) {
    console.error('Mobile photo update error:', error);
    return res
      .status(500)
      .json({ success: false, message: error instanceof Error ? error.message : 'Photo update failed' });
  }
};

export const changePasword = async (
  req: Request<{}, {}, { currentPassword: string; newPassword: string }>,
  res: Response,
) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const schema = z.object({
    // Optional: social-only users (Apple/Google) have no current password to
    // supply — they're SETTING one. The verify below only runs when a password
    // actually exists on the account.
    currentPassword: z.string().optional(),
    newPassword: z
      .string()
      .min(8)
      .regex(/[0-9]/)
      .regex(/[@$!%*?&#]/)
      .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p)),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Invalid password format' });
  }

  const { currentPassword, newPassword } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Only accounts that already have a local password must prove the current
    // one. Social-only users (no password) skip straight to setting a new one.
    if (!user.googleId && user.password) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, message: 'Current password is required' });
      }
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Wrong current password' });
      }
    }

    const latestPassword = await bcrypt.hash(newPassword, 10);
    await handleChangePassword({ userId, latestPassword });

    return res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Mobile change password error:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Password update failed',
    });
  }
};

export const tokenRefresh = async (req: Request, res: Response) => {
  try {
    const refreshSchema = z.object({ refreshToken: z.string().min(1) });
    const parsed = refreshSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Refresh token required' });
    }

    const { refreshToken } = parsed.data;

    let payload: { userId: string; email: string };

    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token',
      });
    }

    const tokenHash = hashToken(refreshToken);

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: { id: true, email: true, name: true, isActive: true, status: true },
        },
      },
    });

    if (!stored) {
      // Nuke the entire family (revoke ALL tokens from this login session)
      await prisma.refreshToken.deleteMany({
        where: { userId: payload.userId },
      });

      return res.status(401).json({
        success: false,
        message: 'Refresh token reuse detected. Please log in again.',
      });
    }

    if (stored.user.status === 'deleted') {
      await prisma.refreshToken.deleteMany({ where: { userId: stored.userId } });

      return res.status(401).json({
        success: false,
        message: 'Account not found.',
      });
    }

    if (stored.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: stored.id } });

      return res.status(401).json({
        success: false,
        message: 'Refresh token expired',
      });
    }

    const newAccessToken = jwt.sign({ userId: stored.userId, email: stored.user.email }, process.env.ACCESSKEY!, {
      expiresIn: '1m',
    });

    const newRefreshToken = jwt.sign({ userId: stored.userId, email: stored.user.email }, process.env.REFRESHKEY!, {
      expiresIn: '30d',
    });

    const newRefreshTokenHash = hashToken(newRefreshToken);

    await prisma.$transaction([
      // Mark old token as revoked + linked to replacement (audit trail)
      prisma.refreshToken.delete({
        where: { id: stored.id },
      }),
      // Insert new token
      prisma.refreshToken.create({
        data: {
          tokenHash: newRefreshTokenHash,
          userId: stored.user.id,
          expiresAt: getRefreshTokenExpiryDate(),
          userAgent: req.headers['user-agent'] ?? null,
          ipAddress: req.ip ?? null,
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        tokens: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        },
      },
    });
  } catch (error) {
    return res.status(500).json(error);
  }
};

export const verifyEmail = async (req: Request<{}, {}, { email: string; shortCode: string }>, res: Response) => {
  const { email, shortCode } = req.body;

  const normalizedEmail = email?.toLowerCase();

  const sanitizedCode = Array.isArray(shortCode) ? shortCode.join('') : shortCode;

  const userData = await prisma.user.findFirst({
    where: { email: { mode: 'insensitive', equals: normalizedEmail } },
  });

  if (!userData) return res.status(404).json({ success: false, message: 'No pending registration' });
  if (userData.status === 'active') return res.status(409).json({ success: false, message: 'Already verified' });

  const record = await prisma.emailVerification.findFirst({
    where: { user: { id: userData.id } },
    orderBy: { expiredAt: 'desc' },
    include: { user: true },
  });

  if (!record) return res.status(404).json({ success: false, message: 'No pending registration' });

  if (record.attempts && record.attempts >= 5)
    return res.status(429).json({ success: false, message: 'Too many attempts' });

  if (record.expiredAt < new Date()) return res.status(410).json({ success: false, message: 'Code expired' });

  if (record.shortCode !== sanitizedCode) {
    await prisma.emailVerification.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    return res.status(401).json({ success: false, message: 'Invalid code' });
  }

  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: record.user?.id }, data: { status: 'active' } }),
    prisma.emailVerification.deleteMany({
      where: {
        user: {
          id: record.user?.id,
        },
      },
    }),
  ]);

  const accessToken = jwt.sign({ userId: user.id, email: user.email }, process.env.ACCESSKEY!, { expiresIn: '1m' });
  const refreshToken = jwt.sign({ userId: user.id, email: user.email }, process.env.REFRESHKEY!, {
    expiresIn: '30d',
  });

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: dayjs().add(30, 'days').toDate(),
      userAgent: req.headers['user-agent'] ?? null,
      ipAddress: req.ip ?? null,
    },
  });

  // issue your real access + refresh tokens here
  return res.json({ success: true, message: 'Email verified', token: { accessToken, refreshToken } });
};

export const resendVerification = async (req: Request<{}, {}, { email: string }>, res: Response) => {
  const normalizedEmail = req.body.email?.toLowerCase();

  if (!normalizedEmail) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  try {
    const userRecord = await prisma.user.findFirst({
      where: { email: { mode: 'insensitive', equals: normalizedEmail } },
    });

    if (!userRecord) {
      return res.status(404).json({ success: false, message: 'No pending registration found' });
    }

    if (userRecord.status === 'active') {
      return res.status(409).json({ success: false, message: 'Email already verified' });
    }

    // 60s cooldown — derive the last send time from the current code's expiry
    // (expiredAt = sentAt + 15m), so no schema change is needed.
    const last = await prisma.emailVerification.findFirst({
      where: {
        user: {
          id: userRecord.id,
        },
      },
      orderBy: { expiredAt: 'desc' },
    });

    if (last) {
      const lastSentAt = dayjs(last.expiredAt).subtract(15, 'minute');
      const elapsed = dayjs().diff(lastSentAt, 'second');
      if (elapsed < 60) {
        return res.status(429).json({ success: false, retryAfter: 60 - elapsed });
      }
    }

    const token = jwt.sign({ id: userRecord.id }, process.env.ACCESSKEY as Secret, { expiresIn: '15m' });
    const shortCode = generateNumericCode(6);

    // Replace any existing code so there's only ever one live code (also resets attempts).
    await prisma.$transaction([
      prisma.emailVerification.deleteMany({ where: { user: { id: userRecord.id } } }),
      prisma.emailVerification.create({
        data: {
          shortCode,
          user: { connect: { id: userRecord.id } },
          expiredAt: dayjs().add(15, 'minute').toDate(),
          token,
        },
      }),
    ]);

    try {
      await mobileCreatorVerificationEmail(userRecord.email, shortCode);
    } catch (mailError) {
      console.error('Resend verification email failed:', mailError);
      return res
        .status(502)
        .json({ success: false, message: 'Could not send the verification email. Please try again.' });
    }

    return res.json({ success: true, message: 'Verification email re-sent', email: userRecord.email });
  } catch (error) {
    console.error('Resend verification error:', error);
    return res
      .status(400)
      .json({ success: false, message: error instanceof Error ? error.message : 'Error resending code' });
  }
};

type SocialProvider = 'apple' | 'google';

const handleSocialSignIn = async ({
  provider,
  providerId,
  email,
  name,
  appleRefreshToken,
  ipAddress,
  userAgent,
  res,
}: {
  provider: SocialProvider;
  providerId: string;
  email?: string;
  name?: string | null;
  // Apple-only: refresh token from the authorizationCode exchange, persisted so
  // it can be revoked on account deletion (App Store requirement).
  appleRefreshToken?: string | null;
  ipAddress?: string;
  userAgent?: string;
  res: Response;
}) => {
  const idField = provider === 'apple' ? 'appleId' : 'googleId';
  const normalizedEmail = email?.toLowerCase();

  // Only persist the refresh token when we actually got one, so a later sign-in
  // that skipped the exchange doesn't wipe a previously stored token.
  const appleTokenData = appleRefreshToken ? { appleRefreshToken } : {};

  let user = await prisma.user.findFirst({ where: { [idField]: providerId } });

  if (!user && normalizedEmail) {
    const byEmail = await prisma.user.findFirst({
      where: { status: { not: 'deleted' }, email: { mode: 'insensitive', equals: normalizedEmail } },
    });

    if (byEmail) {
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { [idField]: providerId, ...appleTokenData },
      });
    }
  } else if (user && appleRefreshToken) {
    // Existing linked user re-signing in — refresh the stored token.
    user = await prisma.user.update({
      where: { id: user.id },
      data: appleTokenData,
    });
  }

  if (!user) {
    if (!normalizedEmail) {
      return res.status(400).json({ success: false, message: 'No email provided by identity provider' });
    }
    user = await prisma.user.create({
      data: {
        [idField]: providerId,
        email: normalizedEmail,
        name: name || null,
        role: 'creator',
        status: 'active',
        ...appleTokenData,
        creator: { create: { isOnBoardingFormCompleted: false } },
      },
    });

    await createKanbanBoard(user.id, 'creator');
    saveCreatorToSpreadsheet({
      name: user.name || '',
      email: user.email,
      phoneNumber: user.phoneNumber || '',
      country: user.country || '',
      createdAt: user.createdAt || new Date(),
    }).catch((e) => console.error('Error saving creator to spreadsheet:', e));
  }

  // Block unusable states for existing/linked accounts (mirrors `login`).
  const blocked: Record<string, string> = {
    banned: 'Account banned.',
    blacklisted: 'Account blacklisted.',
    suspended: 'Account suspended.',
    spam: 'Account spam.',
    rejected: 'Account rejected.',
    deleted: 'Account not found.',
  };
  if (blocked[user.status]) {
    return res.status(400).json({ message: blocked[user.status] });
  }

  // Issue tokens — same inline pattern as mobile `login`.
  const accessToken = jwt.sign({ userId: user.id, email: user.email }, process.env.ACCESSKEY!, { expiresIn: '1m' });
  const refreshToken = jwt.sign({ userId: user.id, email: user.email }, process.env.REFRESHKEY!, { expiresIn: '30d' });

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashToken(refreshToken),
      userId: user.id,
      expiresAt: dayjs().add(30, 'days').toDate(),
      ipAddress,
      userAgent,
    },
  });

  // Return the creator so the app can route on isOnBoardingFormCompleted.
  const userWithCreator = await prisma.user.findUnique({
    where: { id: user.id },
    include: { creator: true },
  });

  return res.status(200).json({ user: userWithCreator, token: { accessToken, refreshToken } });
};

export const appleLogin = async (
  req: Request<
    {},
    {},
    {
      identityToken?: string;
      authorizationCode?: string;
      email?: string;
      fullName?: string;
      ipAddress?: string;
      userAgent?: string;
    }
  >,
  res: Response,
) => {
  const { identityToken, authorizationCode, email, fullName, ipAddress, userAgent } = req.body;

  if (!identityToken) {
    return res.status(400).json({ success: false, message: 'Missing Apple identity token' });
  }

  try {
    const claims = await appleSignin.verifyIdToken(identityToken, {
      audience: process.env.APPLE_BUNDLE_ID!.split(',').map((s) => s.trim()),
      ignoreExpiration: false,
    });

    // Exchange the one-time authorizationCode for Apple's refresh token so we can
    // revoke it on account deletion. Best-effort (returns null if unconfigured);
    // must not block sign-in.
    const appleRefreshToken = authorizationCode ? await exchangeAppleRefreshToken(authorizationCode) : null;

    return await handleSocialSignIn({
      provider: 'apple',
      providerId: claims.sub,
      email: claims.email || email,
      name: fullName,
      appleRefreshToken,
      ipAddress,
      userAgent,
      res,
    });
  } catch (error) {
    console.log(error);
    return res.status(401).json({ success: false, message: 'Invalid Apple token' });
  }
};

/**
 * Link an Apple account to the CURRENTLY authenticated user (Connected Accounts
 * settings). Unlike `appleLogin` (which find-or-creates), this attaches the
 * verified appleId to req.userId, refusing if that appleId already belongs to a
 * different account.
 */
export const linkApple = async (
  req: Request<{}, {}, { identityToken?: string; authorizationCode?: string }>,
  res: Response,
) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { identityToken, authorizationCode } = req.body;
  if (!identityToken) {
    return res.status(400).json({ success: false, message: 'Missing Apple identity token' });
  }

  try {
    const claims = await appleSignin.verifyIdToken(identityToken, {
      audience: process.env.APPLE_BUNDLE_ID!.split(',').map((s) => s.trim()),
      ignoreExpiration: false,
    });

    // Reject if this Apple identity is already linked to someone else.
    const existing = await prisma.user.findFirst({ where: { appleId: claims.sub } });
    if (existing && existing.id !== userId) {
      return res
        .status(409)
        .json({ success: false, message: 'This Apple account is already linked to another user.' });
    }

    const appleRefreshToken = authorizationCode ? await exchangeAppleRefreshToken(authorizationCode) : null;

    await prisma.user.update({
      where: { id: userId },
      data: {
        appleId: claims.sub,
        // Only overwrite the stored token when we actually got a fresh one.
        ...(appleRefreshToken ? { appleRefreshToken } : {}),
      },
    });

    return res.status(200).json({ success: true, message: 'Apple account linked' });
  } catch (error) {
    console.log(error);
    return res.status(401).json({ success: false, message: 'Invalid Apple token' });
  }
};

/**
 * Unlink the Apple account from the current user. Blocks if Apple is the user's
 * ONLY sign-in method (no password and no other social) to avoid lockout, and
 * revokes the Apple token so the app is removed from the user's Apple ID
 * settings (consistent with account deletion).
 */
export const unlinkApple = async (req: Request, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (!user.appleId) {
      return res.status(400).json({ success: false, message: 'Apple account is not linked' });
    }

    // Prevent lockout: Apple can only be removed if the user has another way in.
    const hasOtherLogin = Boolean(user.password) || Boolean(user.googleId);
    if (!hasOtherLogin) {
      return res.status(400).json({
        success: false,
        message: 'Apple is your only sign-in method. Set a password or link another account first.',
      });
    }

    const tokenToRevoke = user.appleRefreshToken;

    await prisma.user.update({
      where: { id: userId },
      data: { appleId: null, appleRefreshToken: null },
    });

    // Best-effort revoke (never blocks) — removes the app from Apple ID settings.
    if (tokenToRevoke) {
      await revokeAppleToken(tokenToRevoke);
    }

    return res.status(200).json({ success: true, message: 'Apple account unlinked' });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ success: false, message: 'Failed to unlink Apple account' });
  }
};

export const completeOnboarding = async (req: Request<{}, {}, { creatorData?: MobileCreatorData }>, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { creatorData } = req.body;
  if (!creatorData) {
    return res.status(400).json({ success: false, message: 'Missing creator data' });
  }

  const missing: string[] = [];
  if (!creatorData.Nationality) missing.push('Nationality');
  if (!creatorData.city && !creatorData.state) missing.push('city or state');
  if (!creatorData.phone || creatorData.phone.trim().length < 7) missing.push('phone');
  if (!creatorData.pronounce) missing.push('pronounce');
  if (!creatorData.birthDate) missing.push('birthDate');
  if (!creatorData.languages || creatorData.languages.length < 1) missing.push('languages (min 1)');
  if (!creatorData.interests || creatorData.interests.length < 3) missing.push('interests (min 3)');
  const hasSocial =
    (creatorData.instagramProfileLink && creatorData.instagramProfileLink.trim().length > 0) ||
    (creatorData.tiktokProfileLink && creatorData.tiktokProfileLink.trim().length > 0);
  if (!hasSocial) missing.push('instagramProfileLink or tiktokProfileLink');
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `Missing required fields: ${missing.join(', ')}` });
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          phoneNumber: creatorData.phone || '',
          country: creatorData.Nationality || '',
          city: creatorData.city || creatorData.state || '',
          ...(creatorData.referralCode ? { referralCode: creatorData.referralCode } : {}),
        },
      });

      await tx.creator.update({
        where: { userId },
        data: {
          isOnBoardingFormCompleted: true,
          instagram: creatorData.instagram || '',
          pronounce: creatorData.pronounce || '',
          birthDate: creatorData.birthDate ? new Date(creatorData.birthDate) : null,
          ...(isEmployment(creatorData.employment) && { employment: creatorData.employment }),
          tiktok: creatorData.tiktok || '',
          languages: creatorData.languages || [],
          instagramProfileLink: creatorData.instagramProfileLink || '',
          tiktokProfileLink: creatorData.tiktokProfileLink || '',
          state: creatorData.state || '',
        },
      });

      if (creatorData.interests && creatorData.interests.length > 0) {
        await tx.interest.deleteMany({ where: { userId } });
        await tx.interest.createMany({
          data: creatorData.interests.map((interest) => ({
            name: typeof interest === 'string' ? interest : interest.name,
            userId,
          })),
        });
      }
    });

    const userWithCreator = await prisma.user.findUnique({
      where: { id: userId },
      include: { creator: true },
    });

    return res.status(200).json({ success: true, user: userWithCreator });
  } catch (error) {
    console.error('completeOnboarding error:', error);
    return res.status(500).json({ success: false, message: error instanceof Error ? error.message : 'Failed' });
  }
};
