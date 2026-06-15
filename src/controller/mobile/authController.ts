import { prisma } from '@/src/prisma/prisma';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import jwt, { Secret } from 'jsonwebtoken';
import { generateRandomString } from '@/src/utils/randomString';
import dayjs from 'dayjs';
import { creatorVerificationEmail, mobileCreatorVerificationEmail } from '@/src/config/nodemailer.config';
import { uploadProfileImage } from '@/src/config/cloudStorage.config';
import { handleChangePassword } from '@/src/service/authServices';
import { z } from 'zod';
import { getRefreshTokenExpiryDate, hashToken, verifyRefreshToken } from '@/src/utils/tokens';
import { delay } from 'bullmq';
import crypto from 'crypto';
import { createKanbanBoard } from '../kanbanController';

interface MobileCreatorData {
  phone?: string;
  Nationality?: string;
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
    if (!creatorData.city) missing.push('city');
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

    if (existing?.status === 'active') {
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
          city: creatorData?.city || '',
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
    }
  >,
  res: Response,
) => {
  // `authenticate` middleware sets req.userId from session OR JWT bearer token
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { name, phone, Nationality, city, pronounce, birthDate } = req.body;

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

      if (updatedUser.role === 'creator' && (pronounce !== undefined || birthDate !== undefined)) {
        await tx.creator.update({
          where: { userId },
          data: {
            ...(pronounce !== undefined && { pronounce }),
            ...(birthDate !== undefined && {
              birthDate: birthDate ? new Date(birthDate) : null,
            }),
          },
        });
      }

      return updatedUser;
    });

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
    currentPassword: z.string().min(1),
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

    if (!user.googleId && user.password) {
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
          select: { id: true, email: true, name: true, isActive: true },
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
