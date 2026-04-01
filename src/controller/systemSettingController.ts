import WhatsappSetting from '@services/verificationCode';
import { Request, Response } from 'express';

export const getWhatsappSetting = async (req: Request, res: Response) => {
  try {
    const data = await WhatsappSetting.initialize();
    if (!data.success) return res.status(400).json(data);

    return res.status(200).json(data);
  } catch (error) {
    return res.status(400).json(error);
  }
};
