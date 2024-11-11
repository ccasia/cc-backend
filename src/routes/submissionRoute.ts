import { Router } from 'express';
import {
  adminManageAgreementSubmission,
  adminManageDraft,
  adminManagePosting,
  agreementSubmission,
  draftSubmission,
  getSubmissionByCampaignCreatorId,
  postingSubmission,
} from '@controllers/submissionController';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { isSuperAdmin } from '@middlewares/onlySuperadmin';

const router = Router();

// router.get('/dependencies', async (req, res) => {
//   try {
//     const test = await prisma.submissionDependency.findMany({
//       include: {
//         submission: {
//           include: {
//             submissionType: true,
//           },
//         },
//         dependentSubmission: {
//           include: {
//             submissionType: true,
//           },
//         },
//       },
//     });
//     return res.status(200).json(test);
//   } catch (error) {
//     return res.status(404).json(error);
//   }
// });

router.get('/', isLoggedIn, getSubmissionByCampaignCreatorId);

router.post('/submitAgreement', isLoggedIn, agreementSubmission);
router.post('/draftSubmission', isLoggedIn, draftSubmission);
router.post('/postSubmission', isLoggedIn, postingSubmission);

router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);
router.patch('/adminManageDraft', isSuperAdmin, adminManageDraft);
router.patch('/adminManagePosting', isSuperAdmin, adminManagePosting);

export default router;
