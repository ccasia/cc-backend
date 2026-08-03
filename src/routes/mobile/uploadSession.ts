// routes/upload-sessions.ts
import { generateResumableSessionUrl } from '@/src/lib/gcs';
import { prisma } from '@/src/prisma/prisma';
import { Router } from 'express';

const router = Router();

router.post('/upload-sessions', async (req, res) => {
  try {
    const { userId, campaignId, submissionId, contentType, fileName, fileSize } = req.body;

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
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
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
router.patch('/upload-sessions/:id/session-uri', async (req, res) => {
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

export default router;
