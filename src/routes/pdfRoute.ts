import express from 'express';
import { storage } from '@configs/cloudStorage.config';

const router = express.Router();

// PDF proxy routes to bypass CORS issues
// 1) Catch-all route that accepts an encoded full path in a single param
router.get('/agreement-template/:encodedPath', async (req, res, next) => {
  try {
    const { encodedPath } = req.params as { encodedPath: string };
    const bucketName = process.env.BUCKET_NAME as string;
    const bucket = storage.bucket(bucketName);

    const decodedPath = decodeURIComponent(encodedPath);

    // Basic request diagnostics
    console.log('[PDF ROUTE] Incoming request (single param)');
    console.log('  originalUrl:', req.originalUrl);
    console.log('  encodedPath:', encodedPath);
    console.log('  decodedPath:', decodedPath);
    console.log('  bucketName :', bucketName);
    console.log('  referer    :', req.get('referer'));
    console.log('  user-agent :', req.get('user-agent'));

    // Try direct decodedPath first
    const directFile = bucket.file(decodedPath);
    const [directExists] = await directFile.exists();
    if (directExists) {
      const [fileBuffer] = await directFile.download();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${decodedPath.split('/').pop() || 'document.pdf'}"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Length', fileBuffer.length.toString());
      console.log('[PDF ROUTE] Served (single param) from:', decodedPath);
      return res.send(fileBuffer);
    }

    // If not found, try common folders with the last segment as filename
    const lastSegment = decodedPath.split('/').pop() as string;
    const possiblePaths = [
      `creatorAgreements/${lastSegment}`,
      `agreementTemplates/${lastSegment}`,
      lastSegment,
    ];

    for (const path of possiblePaths) {
      const testFile = bucket.file(path);
      const [exists] = await testFile.exists();
      if (exists) {
        const [fileBuffer] = await testFile.download();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${lastSegment}"`);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Length', fileBuffer.length.toString());
        console.log('[PDF ROUTE] Served (fallback single param) from:', path);
        return res.send(fileBuffer);
      }
    }

    console.error('[PDF ROUTE] PDF not found (single param):', decodedPath);
    return res.status(404).json({ error: 'PDF not found', pathTried: decodedPath });
  } catch (error) {
    console.error('[PDF ROUTE] Error (single param):', error);
    return res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// 2) Two-segment route with explicit folder and filename
router.get('/agreement-template/:folder/:filename', async (req, res) => {
  try {
    const { folder, filename } = req.params;
    const bucketName = process.env.BUCKET_NAME as string;
    const bucket = storage.bucket(bucketName);
    
    // Decode the folder and filename from URL encoding
    const decodedFolder = decodeURIComponent(folder);
    const decodedFilename = decodeURIComponent(filename);
    
    // Construct the full path
    const filePath = `${decodedFolder}/${decodedFilename}`;
    const file = bucket.file(filePath);
    
    console.log('[PDF ROUTE] Incoming request (two params)');
    console.log('  originalUrl:', req.originalUrl);
    console.log('  folder     :', folder, '->', decodedFolder);
    console.log('  filename   :', filename, '->', decodedFilename);
    console.log('  filePath   :', filePath);
    console.log('  bucketName :', bucketName);
    console.log('  referer    :', req.get('referer'));
    console.log('  user-agent :', req.get('user-agent'));
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      console.error('[PDF ROUTE] PDF not found (two params):', filePath);
      return res.status(404).json({ error: 'PDF not found', filePath });
    }
    
    // Download file from Google Cloud Storage
    const [fileBuffer] = await file.download();
    
    // Set appropriate headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${decodedFilename}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', fileBuffer.length.toString());
    
    // Send the PDF
    res.send(fileBuffer);
  } catch (error) {
    console.error('[PDF ROUTE] Error (two params):', error);
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// Alternative simpler route for direct PDF access
router.get('/pdf/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const bucket = storage.bucket(process.env.BUCKET_NAME as string);
    
    // Try different possible paths
    const possiblePaths = [
      `creatorAgreements/${filename}`,
      `agreementTemplates/${filename}`,
      filename
    ];
    
    let file = null;
    let filePath = null;
    
    for (const path of possiblePaths) {
      const testFile = bucket.file(path);
      const [exists] = await testFile.exists();
      if (exists) {
        file = testFile;
        filePath = path;
        break;
      }
    }
    
    if (!filePath || !file) {
      console.error('PDF not found in any path:', filename);
      return res.status(404).json({ error: 'PDF not found' });
    }
    
    console.log('Serving PDF from:', filePath);
    
    // Download file from Google Cloud Storage
    const [fileBuffer] = await file.download();
    
    // Set appropriate headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', fileBuffer.length.toString());
    
    // Send the PDF
    res.send(fileBuffer);
  } catch (error) {
    console.error('PDF serve error:', error);
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

export default router;
