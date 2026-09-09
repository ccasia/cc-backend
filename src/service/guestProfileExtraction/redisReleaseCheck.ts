import type Redis from 'ioredis';

/**
 * Release gate: the queue must survive a restart.
 *
 * A volatile Redis is not an acceptable durability setup for paid work. This
 * check is a gate, not a warning.
 */

export interface RedisReleaseCheck {
  ok: boolean;
  appendOnly: string | null;
  maxMemoryPolicy: string | null;
  problems: string[];
}

export async function checkRedisReleaseConfig(client: Pick<Redis, 'config'>): Promise<RedisReleaseCheck> {
  const read = async (key: string): Promise<string | null> => {
    try {
      const pairs = (await client.config('GET', key)) as unknown as string[];
      return Array.isArray(pairs) && pairs.length >= 2 ? pairs[1] : null;
    } catch {
      return null;
    }
  };

  const [appendOnly, maxMemoryPolicy] = await Promise.all([read('appendonly'), read('maxmemory-policy')]);

  const problems: string[] = [];
  if (appendOnly !== 'yes') {
    problems.push(`Redis appendonly is "${appendOnly ?? 'unknown'}". Queue work would not survive a restart.`);
  }
  if (maxMemoryPolicy !== 'noeviction') {
    problems.push(`Redis maxmemory-policy is "${maxMemoryPolicy ?? 'unknown'}". Jobs could be evicted.`);
  }

  return { ok: problems.length === 0, appendOnly, maxMemoryPolicy, problems };
}
