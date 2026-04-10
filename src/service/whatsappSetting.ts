import { WhatsappSetting as WhatsappSettingType } from '@prisma/client';
import { prisma } from '../prisma/prisma';
import { Queue } from 'bullmq';
import connection from '@configs/redis';
import axios from 'axios';
import dayjs from 'dayjs';

const whatsappQueue = new Queue('verification-code', { connection });

const GRAPH_API_VERSION = 'v25.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

class WhatsappSetting {
  #setting: WhatsappSettingType | undefined = undefined;

  get #initialized(): WhatsappSettingType {
    if (!this.#setting) {
      throw new Error('Whatsapp setting is not initialized. Call initialize() first.');
    }
    return this.#setting;
  }

  get #headers() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.#initialized.accessToken}`,
    };
  }

  async initialize(): Promise<{ success: false; message: string } | { success: true; data: WhatsappSettingType }> {
    const whatsappSetting = await prisma.whatsappSetting.findFirst();

    if (!whatsappSetting) {
      return { success: false, message: 'No setting found. Please setup first.' };
    }

    this.#setting = whatsappSetting;
    return { success: true, data: whatsappSetting };
  }

  static async saveSetting(
    accessToken: string,
    phoneNumberId: string,
    isFeatureEnabled: boolean,
    templateName: string,
    businessAccountId: string,
  ) {
    if (!accessToken || !phoneNumberId) {
      throw new Error('Access token or Phone Number ID is required.');
    }

    const existing = await prisma.whatsappSetting.findFirst();

    await prisma.whatsappSetting.upsert({
      where: { id: existing?.id ?? '' },
      update: { accessToken, phoneNumberId, templateName, isFeatureEnabled, businessAccountId },
      create: { accessToken, phoneNumberId, templateName, isFeatureEnabled, businessAccountId },
    });

    return { success: true, message: 'Successfully updated.' };
  }

  async toggleSetting() {
    const existing = await prisma.whatsappSetting.findFirst();

    await prisma.whatsappSetting.upsert({
      where: { id: existing?.id ?? '' },
      update: { isFeatureEnabled: !existing?.isFeatureEnabled },
      create: { isFeatureEnabled: true },
    });

    return { success: true, message: 'Successfully updated.' };
  }

  async sendVerificationCode(to: string, token: string) {
    if (!to) throw new Error('Phone number is required.');

    await whatsappQueue.add(
      'verification-code',
      { to, settings: this.#initialized, code: token },
      { removeOnComplete: true },
    );

    return { success: true };
  }

  async getMessageTemplate() {
    const res = await axios.get(`${GRAPH_API_BASE}/${this.#initialized.businessAccountId}/message_templates`, {
      headers: this.#headers,
    });

    return res.data;
  }

  async getMessageInsight() {
    const start = dayjs().subtract(7, 'days').unix();
    const end = dayjs().unix();

    const res = await axios.get(`${GRAPH_API_BASE}/${this.#initialized.businessAccountId}`, {
      params: {
        fields: `analytics.start(${start}).end(${end}).granularity(DAY)`,
      },
      headers: this.#headers,
    });

    const dataPoints: { sent: number; delivered: number }[] = res.data?.analytics?.data_points ?? [];

    const customData = dataPoints.reduce(
      (acc, cur) => ({
        sent: acc.sent + cur.sent,
        delivered: acc.delivered + cur.delivered,
      }),
      { sent: 0, delivered: 0 },
    );

    return { ...res.data, customData };
  }

  async getMessagesData() {
    const [inbound, outbound] = await Promise.all([
      prisma.whatsappMessage.findMany({
        where: { direction: 'inbound' },
        orderBy: { sentAt: 'desc' },
      }),
      prisma.whatsappMessage.findMany({
        where: { direction: 'outbound' },
        orderBy: { sentAt: 'desc' },
      }),
    ]);

    return { inbound, outbound };
  }

  async getConversationAnalytics() {
    const end = Math.floor(Date.now() / 1000);
    const start = end - 30 * 24 * 60 * 60;

    const res = await axios.get(
      `https://graph.facebook.com/v25.0/${this.#initialized.businessAccountId}?fields=conversation_analytics.start(${start}).end(${end}).granularity(DAILY).phone_numbers([]).dimensions(["CONVERSATION_CATEGORY","CONVERSATION_TYPE","COUNTRY","PHONE"])&access_token=${this.#initialized.accessToken}`,
    );

    // const res = await axios.get(`${GRAPH_API_BASE}/${this.#initialized.businessAccountId}`, {
    //   params: {
    //     fields,
    //     access_token: this.#initialized.accessToken,
    //   },
    // });

    console.log(res.data);
    return res.data;
  }
}

export default WhatsappSetting;

for (var feature in fs) {
  var split_array = Split(feature['Report_road_condition'], ',');
  var count_arr = Count(split_array);
  for (var i = 0; i < count_arr; i++) {
    choicesDict.features[index++] = {
      attributes: { split_choices: Trim(split_array[i]) },
    };
  }
}
