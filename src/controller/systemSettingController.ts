import WhatsappSetting from '@services/whatsappSetting';
import { Request, response, Response } from 'express';

export const getWhatsappSetting = async (req: Request, res: Response) => {
  try {
    const whatsappSetting = new WhatsappSetting();
    const data = await whatsappSetting.initialize();

    if (!data.success) return res.status(404).json(data);

    return res.status(200).json({ ...data });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const updateWhatsappSetting = async (
  req: Request<
    {},
    {},
    {
      isFeatureEnabled: boolean;
      phoneNumberId: string;
      accessToken: string;
      templateName: string;
      businessAccountId: string;
    }
  >,
  res: Response,
) => {
  const { isFeatureEnabled, phoneNumberId, accessToken, templateName, businessAccountId } = req.body;

  if (!accessToken || !phoneNumberId) {
    return res.status(400).json({ success: false, message: 'accessToken and phoneNumberId are required.' });
  }

  try {
    const result = await WhatsappSetting.saveSetting(
      accessToken,
      phoneNumberId,
      isFeatureEnabled,
      templateName,
      businessAccountId,
    );
    return res.status(result.success ? 200 : 500).json(result);
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: error instanceof Error ? error.message : 'Internal server error' });
  }
};

export const getInsight = async (req: Request, res: Response) => {
  try {
    const whatsappSetting = new WhatsappSetting();
    await whatsappSetting.initialize();

    const messageInsights = await whatsappSetting.getMessageInsight();

    console.log(messageInsights);

    return res.status(200).json(messageInsights);
  } catch (error) {
    return res.status(500).json(error);
  }
};

export const toggleWhatsappSetting = async (req: Request, res: Response) => {
  try {
    const whatsapp = new WhatsappSetting();
    await whatsapp.initialize();

    const response = whatsapp.toggleSetting();

    return res.status(200).json(response);
  } catch (error) {
    return res.status(500).json(error);
  }
};

export const getWhatsappMessage = async (req: Request, res: Response) => {
  try {
    const whatsapp = new WhatsappSetting();
    await whatsapp.initialize();

    const message = await whatsapp.getMessagesData();

    return res.status(200).json({ message });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
