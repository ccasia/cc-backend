import { Router } from 'express';
import { agreementSubmission } from 'src/controller/submissionController';
import { isLoggedIn } from 'src/middleware/onlyLogin';

const router = Router();

router.post('/submitAgreement', isLoggedIn, agreementSubmission);

export default router;
