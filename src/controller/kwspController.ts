import { Request, Response } from 'express';
import { createNewKWSPRowData } from '@services/google_sheets/sheets';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const submitKWSPForm = async (req: Request, res: Response) => {
  try {
    const { fullName, nricPassport } = req.body;
    const { userid } = req.session;

    if (!fullName || !nricPassport) {
      return res.status(400).json({
        success: false,
        message: 'Full name and NRIC/Passport number are required',
      });
    }

    // Get user email from database
    const user = await prisma.user.findUnique({
      where: {
        id: userid,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Get the current date and time in Malaysia timezone
    const currentDate = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Kuala_Lumpur',
    });

    await createNewKWSPRowData({
      spreadSheetId: '1Itu5lEgICO2VZWNG0oP4F2gjMBhILSAtVw74JlYpcpc',
      sheetByTitle: 'Platform Sign ups',
      data: {
        fullName,
        nricPassport,
        date: currentDate,
        email: user.email,
      },
    });

    // Mark user as submitted
    await prisma.user.update({
      where: {
        id: userid,
      },
      data: {
        hasSubmittedKWSP: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Form submitted successfully',
    });
  } catch (error) {
    console.error('Error submitting KWSP form:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to submit form',
      error: error.message,
    });
  }
};
