import { PrismaClient, WhatsappSetting as WhatsappSetttingTest } from '@prisma/client';

const prisma = new PrismaClient();

class WhatsappSetting {
  //   static async initialize(): Promise<{ success: boolean; message: string } | WhatsappSetttingTest> {
  //     const whatsappSetting = await prisma.whatsappSetting.findFirst();

  //     if (!whatsappSetting) return { success: false, message: 'No setting found. Please create first.' };

  //     return whatsappSetting;
  //   }

  static async initialize(): Promise<{ success: false; message: string } | { success: true; data: WhatsappSetting }> {
    const whatsappSetting = await prisma.whatsappSetting.findFirst();

    if (!whatsappSetting) {
      return { success: false, message: 'No setting found. Please setup first.' };
    }

    return { success: true, data: whatsappSetting };
  }

  static async saveSetting(accessToken: string, businessAccountId: string, templateName?: string) {
    if (!accessToken || !businessAccountId) {
      throw new Error('Access token or Business Account ID is required.');
    }

    const whatsappSetting = await prisma.whatsappSetting.findFirst();

    if (whatsappSetting) {
      await prisma.whatsappSetting.update({
        where: {
          id: whatsappSetting.id,
        },
        data: {
          accessToken,
          businessAccountId,
          templateName: templateName || '',
        },
      });
    } else {
      await prisma.whatsappSetting.create({
        data: {
          accessToken,
          businessAccountId,
          templateName: templateName || '',
        },
      });
    }

    return { status: 200, success: true };
  }
}

export default WhatsappSetting;
