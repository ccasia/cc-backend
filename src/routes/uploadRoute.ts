import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { generateResumableSessionUrl } from '../lib/gcs';
import { prisma } from '../prisma/prisma';
import { bigIntSerializerMiddleware } from '../middleware/bigIntSerializer';
import { Queue } from 'bullmq';
import connection from '../config/redis';

const router = Router();
const compressionQueue = new Queue('compression-queue', { connection: connection });

router.use(authenticate);
router.use(bigIntSerializerMiddleware);

router.get('/', async (req, res) => {
  try {
    const submissionId = req.query.submissionId as string;
    const userId = req.userId;

    const uploadSessions = await prisma.uploadSession.findMany({
      where: {
        submissionId: submissionId!,
        userId,
        status: 'UPLOADING',
        gcsSessionUri: { not: null },
        expiresAt: { gt: new Date() },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return res.status(200).json({ uploadSessions: uploadSessions });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch upload session' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { campaignId, submissionId, contentType, fileName, fileSize } = req.body;

    const userId = req.userId;

    if (!userId || !contentType || !fileName || !fileSize) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const objectPath = `raw/${userId}/${Date.now()}-${fileName}`;
    const signedUrl = await generateResumableSessionUrl(objectPath, contentType);

    const session = await prisma.uploadSession.create({
      data: {
        gcsObjectPath: objectPath,
        userId,
        campaignId: campaignId ?? null,
        submissionId: submissionId ?? null,
        bytesTotal: BigInt(fileSize),
        status: 'INITIATED',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 7 days
        fileName: fileName,
      },
    });

    res.json({
      uploadSessionId: session.id,
      signedUrl, // client POSTs here with X-Goog-Resumable: start to kick off the real session
    });
  } catch (err) {
    console.error('Failed to create upload session:', err);
    res.status(500).json({ error: 'Failed to initiate upload' });
  }
});

// Client reports the Location header it got back from GCS after the initiation POST
router.patch('/:id/session-uri', async (req, res) => {
  try {
    const { sessionUri } = req.body;
    if (!sessionUri) return res.status(400).json({ error: 'Missing sessionUri' });

    const session = await prisma.uploadSession.update({
      where: { id: req.params.id },
      data: { gcsSessionUri: sessionUri, status: 'UPLOADING' },
    });

    res.json(session);
  } catch (err) {
    console.error('Failed to update session URI:', err);
    res.status(500).json({ error: 'Failed to update session' });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;

    const session = await prisma.uploadSession.findUnique({ where: { id } });

    if (!session) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    if (
      session.status === 'COMPLETED' ||
      session.status === 'QUEUED_FOR_COMPRESSION' ||
      session.status === 'COMPRESSING'
    ) {
      // idempotency guard — client retries or duplicate calls shouldn't double-enqueue
      return res.json({ status: session.status });
    }

    const updated = await prisma.uploadSession.update({
      where: { id },
      data: { status: 'RAW_UPLOAD_COMPLETE', completedAt: new Date() },
    });

    await compressionQueue.add(
      'compression-queue',
      {
        uploadSessionId: updated.id,
        rawObjectPath: updated.gcsObjectPath,
        userId: updated.userId,
        campaignId: updated.campaignId,
        submissionId: updated.submissionId,
      },
      { jobId: `compress-${updated.id}`, removeOnComplete: true, attempts: 2 },
    );

    await prisma.uploadSession.update({
      where: { id },
      data: { status: 'QUEUED_FOR_COMPRESSION' },
    });

    res.json({ status: 'QUEUED_FOR_COMPRESSION' });
  } catch (err) {
    console.error('Failed to complete upload session:', err);
    res.status(500).json({ error: 'Failed to complete upload' });
  }
});

export default router;
