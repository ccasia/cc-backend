import { PrismaClient  , NotificationType, category} from '@prisma/client';

const prisma = new PrismaClient();

interface Notification {
  receiver_id: string;
  title: string;
  type: string;
  created_at: Date;
  category: string;
}

export const getNotificationsById = async (userId: string) => {
  try {
    const res = await prisma.notification.findMany({
      where: {
        receiver_id: userId,
      },
    });

    return res;
  } catch (error) {
    console.log(error);
  }
};

export const createNotification = async (data: Notification) => {
  try {
    const res = await prisma.notification.create({
      data: {
        receiver_id: data.receiver_id,
        title: data.title,
        type: data.type as NotificationType,
        category:data.category as category,
      },
    });

    return res;
  } catch (error) {
    console.log(error);
  }
};
