import { Router } from 'express';

const router = Router();

import {
  createInvoice,
  getInvoicesByCreatorId,
  getInvoicesByCampaignId,
  getInvoiceById,
  getInvoiceByCreatorIdAndCampaignId,
  updateInvoiceStatus,
  updateInvoice,
  getAllInvoices,
  getXero,
  xeroCallBack,
  getXeroContacts,
  checkRefreshToken,
  deleteInvoice,
} from '@controllers/invoiceController';
import { checkAndRefreshAccessToken } from '@controllers/invoiceController';
import { creatorInvoice } from '@controllers/invoiceController';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { createInvoiceService } from '@services/invoiceService';
// import { prisma } from 'src/prisma/prisma';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

router.get('/zeroConnect', isSuperAdmin, getXero);
router.get('/xeroCallback', xeroCallBack);
router.get('/getXeroContacts', checkAndRefreshAccessToken, getXeroContacts);
router.get('/checkRefreshToken', isSuperAdmin, checkRefreshToken);
router.get('/creator', getInvoicesByCreatorId);
router.get('/:id', getInvoiceById);
router.get('/', isSuperAdmin, getAllInvoices);
router.get('/getInvoicesByCampaignId/:id', getInvoicesByCampaignId);

router.get('/creator/:creatorId/campaign/:campaignId', getInvoiceByCreatorIdAndCampaignId);
router.get('/creatorInvoice/:invoiceId', isLoggedIn, creatorInvoice);

router.post('/create', createInvoice);

router.patch('/updateStatus', updateInvoiceStatus);
router.patch('/update', updateInvoice);

router.delete('/:id', isSuperAdmin, deleteInvoice);

// Temporary function
router.post('/generateInvoice', async (req, res) => {
  const { submissionId, invoiceAmount } = req.body;

  try {
    const submission = await prisma.submission.findUnique({
      where: {
        id: submissionId,
      },
      include: {
        user: {
          include: {
            creator: true,
            paymentForm: true,
            creatorAgreement: true,
            Board: true,
          },
        },
        campaign: {
          include: {
            campaignBrief: true,
            campaignAdmin: {
              include: {
                admin: {
                  select: {
                    role: true,
                    user: {
                      select: {
                        Board: true,
                        id: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        task: true,
      },
    });

    if (!submission) return res.status(404).json({ message: 'Invoice not found' });
    await createInvoiceService(submission, submission.userId, invoiceAmount, undefined, undefined, undefined);

    return res.status(200).send('Success');
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
});

export default router;
