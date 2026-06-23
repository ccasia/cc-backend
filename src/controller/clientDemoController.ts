import { Request, Response } from 'express';
import jwt, { Secret } from 'jsonwebtoken';
import { generateRandomString } from '@utils/randomString';
import { prisma } from '../prisma/prisma';

const DEMO_TOKEN_LENGTH = 32;

const getDemoUrl = (token: string) => {
  const base = process.env.APP_PUBLIC_URL || process.env.BACKEND_URL || 'http://localhost';
  return `${base.replace(/\/$/, '')}/client-demo/${token}`;
};

const generateUniqueDemoToken = async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const token = generateRandomString(DEMO_TOKEN_LENGTH);
    const clash = await prisma.client.findUnique({ where: { demoAccessToken: token } });
    if (!clash) return token;
  }

  throw new Error('Could not generate a unique demo token after 5 attempts');
};

export const createClientDemo = async (req: Request, res: Response) => {
  const rawName = String(req.body?.name || '').trim();
  if (!rawName) return res.status(400).json({ message: 'Demo client name is required' });

  try {
    const demoAccessToken = await generateUniqueDemoToken();
    const demoEmail = `demo+${demoAccessToken.toLowerCase()}@cultcreativeasia.com`;

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({
        data: {
          name: rawName,
          email: demoEmail,
          type: 'directClient',
          pic: {
            create: {
              name: rawName,
              email: demoEmail,
              designation: 'Demo Client',
            },
          },
        },
      });

      const user = await tx.user.create({
        data: {
          email: demoEmail,
          password: '',
          role: 'client_demo',
          status: 'active',
          isActive: true,
          isVerified: true,
          name: rawName,
        },
      });

      const client = await tx.client.create({
        data: {
          userId: user.id,
          companyId: company.id,
          clientType: 'demoClient',
          demoAccessToken,
        },
      });

      return { company, user, client };
    });

    return res.status(201).json({
      message: 'Client demo created',
      companyId: result.company.id,
      clientId: result.client.id,
      userId: result.user.id,
      name: result.company.name,
      token: demoAccessToken,
      url: getDemoUrl(demoAccessToken),
    });
  } catch (error: any) {
    console.error('createClientDemo error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to create client demo' });
  }
};

export const getClientDemoLinkByCompany = async (req: Request, res: Response) => {
  const companyId = String(req.params.companyId || '').trim();
  if (!companyId) return res.status(400).json({ message: 'companyId is required' });

  try {
    const client = await prisma.client.findFirst({
      where: {
        companyId,
        clientType: 'demoClient',
        demoAccessToken: { not: null },
      },
      include: {
        company: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true, role: true, status: true } },
      },
    });

    if (!client?.demoAccessToken) {
      return res.status(404).json({ message: 'Demo link not found' });
    }

    return res.status(200).json({
      companyId: client.companyId,
      clientId: client.id,
      userId: client.userId,
      name: client.company?.name || client.user.name,
      token: client.demoAccessToken,
      url: getDemoUrl(client.demoAccessToken),
    });
  } catch (error: any) {
    console.error('getClientDemoLinkByCompany error:', error);
    return res.status(500).json({ message: 'Failed to fetch demo link' });
  }
};

export const regenerateClientDemoLink = async (req: Request, res: Response) => {
  const companyId = String(req.params.companyId || '').trim();
  if (!companyId) return res.status(400).json({ message: 'companyId is required' });

  try {
    const client = await prisma.client.findFirst({
      where: {
        companyId,
        clientType: 'demoClient',
        demoAccessToken: { not: null },
      },
      include: {
        company: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });

    if (!client) {
      return res.status(404).json({ message: 'Demo link not found' });
    }

    // Rotate only the access token. The old URL/QR stop working immediately
    // because the session lookup matches on demoAccessToken. IDs and the demo
    // email are intentionally left untouched.
    const demoAccessToken = await generateUniqueDemoToken();

    const updated = await prisma.client.update({
      where: { id: client.id },
      data: { demoAccessToken },
      select: { id: true, userId: true, companyId: true },
    });

    return res.status(200).json({
      companyId: updated.companyId,
      clientId: updated.id,
      userId: updated.userId,
      name: client.company?.name || client.user?.name,
      token: demoAccessToken,
      url: getDemoUrl(demoAccessToken),
    });
  } catch (error: any) {
    console.error('regenerateClientDemoLink error:', error);
    return res.status(500).json({ message: error?.message || 'Failed to regenerate demo link' });
  }
};

export const createClientDemoSession = async (req: Request, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(404).json({ message: 'Not found' });

  try {
    const client = await prisma.client.findUnique({
      where: { demoAccessToken: token },
      include: {
        user: true,
        company: true,
      },
    });

    if (
      !client ||
      !client.user ||
      client.user.role !== 'client_demo' ||
      client.clientType !== 'demoClient' ||
      client.user.status !== 'active'
    ) {
      return res.status(404).json({ message: 'This demo link is no longer valid' });
    }

    const accessToken = jwt.sign({ id: client.user.id }, process.env.ACCESSKEY as Secret, {
      expiresIn: '4h',
    });
    const refreshToken = jwt.sign({ id: client.user.id }, process.env.REFRESHKEY as Secret);

    const session = req.session as any;
    session.userid = client.user.id;
    session.refreshToken = refreshToken;
    session.role = client.user.role;
    session.name = client.user.name || '';
    session.photoURL = client.user.photoURL || '';

    res.cookie('userid', client.user.id, {
      maxAge: 60 * 60 * 24 * 1000,
      httpOnly: true,
    });

    res.cookie('accessToken', accessToken, {
      maxAge: 60 * 60 * 4 * 1000,
      httpOnly: true,
    });

    return res.status(200).json({
      message: 'Demo session created',
      accessToken,
      user: {
        id: client.user.id,
        email: client.user.email,
        name: client.user.name,
        role: client.user.role,
        status: client.user.status,
        client: {
          id: client.id,
          companyId: client.companyId,
          clientType: client.clientType,
          company: client.company,
        },
      },
    });
  } catch (error: any) {
    console.error('createClientDemoSession error:', error);
    return res.status(500).json({ message: 'Failed to start demo session' });
  }
};
