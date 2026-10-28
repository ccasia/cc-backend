import { Request, Response } from 'express';
import type { AppPlatform } from '@prisma/client';
import { checkAppVersion, VERSION_PATTERN } from './app-version.service';
import { listAppVersionPolicies, PolicyUpdateInput, updateAppVersionPolicy } from './app-version.admin';

const MESSAGE_MAX = 200;

const PLATFORMS: Record<string, AppPlatform> = {
  ios: 'IOS',
  android: 'ANDROID',
};

// GET /mobile/app-version?platform=ios&version=1.0.5 — public, called before login
export const getAppVersionCheck = async (req: Request, res: Response) => {
  const platform = PLATFORMS[String(req.query.platform ?? '').toLowerCase()];
  const version = String(req.query.version ?? '');

  if (!platform) return res.status(400).json({ message: 'platform must be ios or android' });
  if (!VERSION_PATTERN.test(version)) return res.status(400).json({ message: 'version must look like 1.2.3' });

  try {
    return res.status(200).json(await checkAppVersion(platform, version));
  } catch (error) {
    console.error('Failed to check app version:', error);
    return res.status(500).json({ message: 'Failed to check app version' });
  }
};

const isVersionOrUndefined = (value: unknown) =>
  value === undefined || (typeof value === 'string' && VERSION_PATTERN.test(value));

const parsePolicyUpdate = (body: any): { ok: true; data: PolicyUpdateInput } | { ok: false; message: string } => {
  const { minimumVersion, latestVersion, message } = body ?? {};

  if (minimumVersion === undefined && latestVersion === undefined && message === undefined) {
    return { ok: false, message: 'No changes to save.' };
  }
  if (!isVersionOrUndefined(minimumVersion) || !isVersionOrUndefined(latestVersion)) {
    return { ok: false, message: 'Enter versions like 1.2.3, using numbers and dots only.' };
  }
  if (message !== undefined && message !== null && (typeof message !== 'string' || message.length > MESSAGE_MAX)) {
    return { ok: false, message: `Message must be text up to ${MESSAGE_MAX} characters` };
  }

  return { ok: true, data: { minimumVersion, latestVersion, message } };
};

// GET /api/app-versions — superadmin
export const getAppVersionPolicies = async (_req: Request, res: Response) => {
  try {
    return res.status(200).json({ data: await listAppVersionPolicies() });
  } catch (error) {
    console.error('Failed to load app version policies:', error);
    return res.status(500).json({ message: 'Failed to load app version policies' });
  }
};

// PATCH /api/app-versions/:platform — superadmin
export const patchAppVersionPolicy = async (req: Request, res: Response) => {
  const platform = PLATFORMS[String(req.params.platform).toLowerCase()];
  if (!platform) return res.status(400).json({ message: 'platform must be ios or android' });

  const parsed = parsePolicyUpdate(req.body);
  if (!parsed.ok) return res.status(400).json({ message: parsed.message });

  try {
    const result = await updateAppVersionPolicy(platform, parsed.data, req.userId as string);
    if (!result.ok) return res.status(result.status).json({ message: result.message });
    return res.status(200).json({ data: result.data });
  } catch (error) {
    console.error('Failed to update app version policy:', error);
    return res.status(500).json({ message: 'Failed to update app version policy' });
  }
};
