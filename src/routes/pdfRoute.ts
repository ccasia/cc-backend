import express from 'express';
import { storage } from '@configs/cloudStorage.config';

const router = express.Router();

// PDF proxy route to bypass CORS issues
router.get('/agreement-template/:folder/:filename', async (req, res) => {
  try {
    const { folder, filename } = req.params;
    const bucket = storage.bucket(process.env.BUCKET_NAME as string);
    
    // Decode the folder and filename from URL encoding
    const decodedFolder = decodeURIComponent(folder);
    const decodedFilename = decodeURIComponent(filename);
    
    // Construct the full path
    const filePath = `${decodedFolder}/${decodedFilename}`;
    const file = bucket.file(filePath);
    
    console.log('Attempting to serve PDF:', filePath);
    
    // Check if file exists
    const [exists] = await file.exists();
    if (!exists) {
      console.error('PDF not found:', filePath);
      return res.status(404).json({ error: 'PDF not found' });
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
    console.error('PDF serve error:', error);
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
