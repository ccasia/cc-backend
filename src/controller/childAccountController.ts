import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import { sendEmail } from '@configs/nodemailer.config';

const prisma = new PrismaClient();

export const addChildAccountsToCampaign = async (parentClientId: string, campaignId: string) => {
  try {
    const childAccounts = await prisma.childAccount.findMany({
      where: {
        parentClientId: parentClientId,
        isActive: true,
      },
    });

    console.log(`Found ${childAccounts.length} active child accounts for parent client ${parentClientId}`);

    // Add each child account to the campaign
    for (const childAccount of childAccounts) {
      try {
        // Find the user record for this child account
        const childUser = await prisma.user.findUnique({
          where: { email: childAccount.email },
          include: { client: true },
        });

        if (childUser && childUser.client) {
          await prisma.campaignAdmin.create({
            data: {
              adminId: childUser.id,
              campaignId: campaignId,
            },
          });
          console.log(`Added child account ${childAccount.email} to campaign ${campaignId}`);
        }
      } catch (error) {
        if (error.code === 'P2002') {
          console.log(`Child account ${childAccount.email} already has access to campaign ${campaignId}`);
        } else {
          console.error(`Error adding child account ${childAccount.email} to campaign ${campaignId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error adding child accounts to campaign:', error);
  }
};

// Get all child accounts for a parent client
export const getChildAccounts = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;

    // Get the current client's company ID
    const currentClient = await prisma.client.findUnique({
      where: { id: clientId },
      select: { companyId: true },
    });

    if (!currentClient) {
      return res.status(404).json({ message: 'Client not found' });
    }

    // Get all clients in the same company
    const companyClients = await prisma.client.findMany({
      where: { companyId: currentClient.companyId },
      select: { id: true },
    });

    const companyClientIds = companyClients.map((client) => client.id);

    // Fetch all child accounts for all clients in the same company
    const childAccounts = await prisma.childAccount.findMany({
      where: {
        parentClientId: {
          in: companyClientIds,
        },
      },
      include: {
        parentClient: {
          include: {
            user: {
              select: {
                email: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.status(200).json(childAccounts);
  } catch (error) {
    console.error('Error fetching child accounts:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get all child accounts (for admin use)
export const getAllChildAccounts = async (req: Request, res: Response) => {
  try {
    const childAccounts = await prisma.childAccount.findMany({
      include: {
        parentClient: {
          include: {
            user: {
              select: {
                email: true,
                name: true,
              },
            },
            company: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return res.status(200).json(childAccounts);
  } catch (error) {
    console.error('Error fetching all child accounts:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Create a new child account invitation
export const createChildAccount = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { email, firstName, lastName } = req.body;

    console.log('Creating child account for client ID:', clientId);
    console.log('Request body:', { email, firstName, lastName });

    // First, verify that the parent client exists
    const parentClient = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: true,
        company: true,
      },
    });

    if (!parentClient) {
      console.log('Parent client not found for ID:', clientId);
      return res.status(404).json({ message: 'Parent client not found' });
    }

    console.log('Parent client found:', parentClient.id);

    // Check if email already exists
    const existingChildAccount = await prisma.childAccount.findFirst({
      where: {
        email: email,
        parentClientId: clientId,
      },
    });

    if (existingChildAccount) {
      return res.status(400).json({
        message: 'This email is already associated with this parent client',
        childAccount: existingChildAccount,
      });
    }

    // Check if email is already a user
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      const childAccount = await prisma.childAccount.create({
        data: {
          email,
          firstName,
          lastName,
          isActive: true,
          parentClientId: clientId,
        },
      });

      const parentUserId = parentClient.user?.id;

      if (parentUserId) {
        const parentCampaigns = await prisma.campaignAdmin.findMany({
          where: {
            adminId: parentUserId,
          },
          select: {
            campaignId: true,
          },
        });
        const campaignIds = parentCampaigns.map((c) => c.campaignId);

        const newAdminEntries = campaignIds.map((campaignId) => ({
          campaignId: campaignId,
          adminId: existingUser.id,
        }));

        if (newAdminEntries.length > 0) {
          await prisma.campaignAdmin.createMany({
            data: newAdminEntries,
            skipDuplicates: true,
          });
          console.log(
            `Added existing child ${email} to ${newAdminEntries.length} campaigns from new parent ${clientId}`,
          );
        }
      }

      return res.status(201).json({
        message: 'Child account invitation sent successfully',
        childAccount,
      });
    } else {
      // Generate invitation token
      const invitationToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 7); // Token expires in 7 days

      // Create child account
      const childAccount = await prisma.childAccount.create({
        data: {
          email,
          firstName,
          lastName,
          parentClientId: clientId,
          invitationToken,
          tokenExpiresAt,
        },
      });

      // Send invitation email
      // const parentClientWithDetails = await prisma.client.findUnique({
      //   where: { id: clientId },
      //   include: {
      //     user: true,
      //     company: true,
      //   },
      // });

      // Helper function to get correct base URL
      const getBaseEmailUrl = () => {
        const baseUrl = process.env.BASE_EMAIL_URL;
        if (!baseUrl) return 'http://localhost';
        return baseUrl;
      };
      
      const baseUrl = getBaseEmailUrl();
      const invitationLink = `${baseUrl}/auth/child-account-setup/${invitationToken}`;

      console.log('BASE_EMAIL_URL:', process.env.BASE_EMAIL_URL);
      console.log('Generated invitation link:', invitationLink);

      const emailContent = {
        to: email,
        subject: `Welcome to Your Client Portal`,
        html: `
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verify Your Email Address</title>
            <style type="text/css">
              @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');
              @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
            </style>
          </head>
          <body style="margin: 0; padding: 0; background-color: #f0f2f5; font-family: 'Inter', Arial, sans-serif;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f0f2f5;">
            <tr>
              <td align="center" style="padding: 20px 10px;">
                <!-- Main Content Wrapper -->
                <table role="presentation" width="500" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width: 400px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden;">
                  
                  <!-- Header: Logo -->
                  <tr>
                    <td style="padding: 30px 20px 10px 20px;">
                      <img src="https://drive.google.com/uc?id=1wbwEJp2qX5Hb9iirUQJVCmdpq-fg34oE" alt="Cult Creative Logo" width="120">
                    </td>
                  </tr>
  
                  <!-- Headline -->
                  <tr>
                    <td style="padding: 10px 30px 20px 30px;">
                      <h1 style="margin: 0; font-family: 'Instrument Serif', Georgia, serif; font-size: 32px; color: #000000; font-weight: 400; line-height: 32px; ">
                        Welcome to Your Client Portal
                      </h1>
                    </td>
                  </tr>
  
                  <!-- Emoji Icon -->
                  <tr>
                    <td align="center" style="padding: 10px 20px;">
                      <img src="https://drive.google.com/uc?id=13c5VhONNva9BMQIwXzn7t8stQrnT0OvV" alt="Rocket Icon" width="80" style="width: 80px; height: auto;">
                    </td>
                  </tr>
  
                  <!-- Body Text -->
                  <tr>
                    <td style="padding: 20px 20px;">
                      <p style="margin: 0 0 15px 0; font-family: 'Inter', Arial, sans-serif; font-size: 16px; color: #000000; line-height: 1.5; text-transform: capitalize">
                        Hey <strong>${firstName || ''}</strong>,
                      </p>
                      <p style="margin: 0; font-family: 'Inter', Arial, sans-serif; font-size: 16px; color: #000000; line-height: 1.5;">
                        Awesome news your account’s all set up! 🙌<br>
                        <br>
                        For your final step click the button below  and set your password to get started!
                      </p>
                    </td>
                  </tr>
  
                  <!-- Main CTA Button -->
                  <tr>
                    <td style="padding: 20px 20px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%">
                        <tr>
                          <td align="center" style="background-color: #1340FF; border-radius: 50px;">
                            <a href="${invitationLink}" style="display: block; padding: 16px 20px; font-family: 'Inter', Arial, sans-serif; font-size: 16px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 50px;">Set Up Account</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
  
                  <!-- Fallback Link -->
                  <tr>
                    <td style="padding: 20px 20px;">
                      <p style="margin: 0; font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: #919191; line-height: 1.5;">
                        This invitation will expire in 7 days.
                        <br>
                        If you didn't expect this invitation, you can safely ignore this email.
                      </p>
                    </td>
                  </tr>
  
                  <!-- Disclaimer -->
                  <tr>
                    <td style="padding: 0 20px 20px 20px;">
                       <p style="margin: 0; font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: #919191; line-height: 1.5;">
                        Didn't sign up for this? You can safely ignore this email and your account will not be created.
                      </p>
                    </td>
                  </tr>
  
  
                 <!-- Footer Section -->
                      <tr>
                        <td style="padding: 20px 20px 40px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f7f7f7;">
                            
                          <!-- Social Icons -->
                            <tr>
                              <td align="center" style="padding: 20px 0 0;">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                  <tr>
                                    <td style="padding: 0 15px;"><a href="https://www.instagram.com/cultcreativeasia/" target="_blank"><img src="https://drive.google.com/uc?id=18U5OsbRLVFGBXpG3Tod3_E_V-CKCoPxn" alt="Instagram" width="28"></a></td>
                                    <td style="padding: 0 15px;"><a href="https://www.linkedin.com/company/cultcreativeapp/" target="_blank"><img src="https://drive.google.com/uc?id=1-OLY5OezbzS7m37xcfLNXvmJyoNhAtTL" alt="LinkedIn" width="28"></a></td>
                                    <td style="padding: 0 15px;"><a href="https://www.cultcreative.asia" target="_blank"><img src="https://drive.google.com/uc?id=1L5rZbPbK3zouf40Krj-CRtmMa94qc_sP" alt="Website" width="28"></a></td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            
                            <!-- Email Link -->
                            <tr>
                              <td align="center">
                                <a href="mailto:hello@cultcreative.asia" style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; text-decoration: underline; font-weight: bold;">hello@cultcreative.asia</a>
                              </td>
                            </tr>
                            <!-- Company Info -->
                            <tr>
                              <td align="center">
                                <p style="padding: 20px; margin: 0; font-family: Arial, sans-serif; font-size: 11px; color: #aaaaaa; line-height: 1.5; text-decoration: none">
                                  Cult Creative Sdn. Bhd.<br>
                                  A-5-3A, Block A, Jaya One, Jln Profesor Diraja Ungku Aziz,<br>
                                  Seksyen 13, 46200 Petaling Jaya, Selangor, Malaysia<br>
                                  Copyright © ${new Date().getFullYear()} Cult Creative, All rights reserved
                                </p>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                </table>
              </td>
            </tr>
          </table>
      </body>
          `,
      };

      sendEmail(emailContent).catch((emailError) => {
        console.error('Error sending invitation email:', emailError);
        return res.status(500).json({ message: 'Failed to send invitation email' });
      });

      return res.status(201).json({
        message: 'Child account invitation sent successfully',
        childAccount,
      });
    }
  } catch (error) {
    console.error('Error creating child account:', error);
    console.error('Full error details:', JSON.stringify(error, null, 2));
    return res.status(500).json({
      message: 'Internal server error',
    });
  }
};

// Resend invitation for a child account
export const resendInvitation = async (req: Request, res: Response) => {
  try {
    const { childAccountId } = req.params;
    console.log('Resending invitation for child account ID:', childAccountId);

    const childAccount = await prisma.childAccount.findUnique({
      where: { id: childAccountId },
      include: {
        parentClient: {
          include: {
            company: true,
          },
        },
      },
    });

    if (!childAccount) {
      return res.status(404).json({ message: 'Child account not found' });
    }

    // Generate new invitation token
    const invitationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiresAt = new Date();
    tokenExpiresAt.setDate(tokenExpiresAt.getDate() + 7);

    // Update child account with new token
    await prisma.childAccount.update({
      where: { id: childAccountId },
      data: {
        invitationToken,
        tokenExpiresAt,
        invitedAt: new Date(),
      },
    });

    // Send new invitation email
    const baseUrl = process.env.BASE_EMAIL_URL || 'http://localhost';
    const invitationLink = `${baseUrl}/auth/child-account-setup/${invitationToken}`;

    const emailContent = {
      to: childAccount.email,
      subject: `Welcome to Your Client Portal`,
      html: `
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify Your Email Address</title>
          <style type="text/css">
            @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
          </style>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f0f2f5; font-family: 'Inter', Arial, sans-serif;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f0f2f5;">
          <tr>
            <td align="center" style="padding: 20px 10px;">
              <!-- Main Content Wrapper -->
              <table role="presentation" width="500" cellspacing="0" cellpadding="0" border="0" align="center" style="max-width: 400px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden;">
                
                <!-- Header: Logo -->
                <tr>
                  <td style="padding: 30px 20px 10px 20px;">
                    <img src="https://drive.google.com/uc?id=1wbwEJp2qX5Hb9iirUQJVCmdpq-fg34oE" alt="Cult Creative Logo" width="120">
                  </td>
                </tr>

                <!-- Headline -->
                <tr>
                  <td style="padding: 10px 30px 20px 30px;">
                    <h1 style="margin: 0; font-family: 'Instrument Serif', Georgia, serif; font-size: 32px; color: #000000; font-weight: 400; line-height: 32px; ">
                      Welcome to Your Client Portal
                    </h1>
                  </td>
                </tr>

                <!-- Emoji Icon -->
                <tr>
                  <td align="center" style="padding: 10px 20px;">
                    <img src="https://drive.google.com/uc?id=13c5VhONNva9BMQIwXzn7t8stQrnT0OvV" alt="Rocket Icon" width="80" style="width: 80px; height: auto;">
                  </td>
                </tr>

                <!-- Body Text -->
                <tr>
                  <td style="padding: 20px 20px;">
                    <p style="margin: 0 0 15px 0; font-family: 'Inter', Arial, sans-serif; font-size: 16px; color: #000000; line-height: 1.5; text-transform: capitalize">
                      Hey <strong>${childAccount.firstName || ''}</strong>,
                    </p>
                    <p style="margin: 0; font-family: 'Inter', Arial, sans-serif; font-size: 16px; color: #000000; line-height: 1.5;">
                      Awesome news your account’s all set up! 🙌<br>
                      <br>
                      For your final step click the button below  and set your password to get started!
                    </p>
                  </td>
                </tr>

                <!-- Main CTA Button -->
                <tr>
                  <td style="padding: 20px 20px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%">
                      <tr>
                        <td align="center" style="background-color: #1340FF; border-radius: 50px;">
                          <a href="${invitationLink}" style="display: block; padding: 16px 20px; font-family: 'Inter', Arial, sans-serif; font-size: 16px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 50px;">Set Up Account</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Fallback Link -->
                <tr>
                  <td style="padding: 20px 20px;">
                    <p style="margin: 0; font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: #919191; line-height: 1.5;">
                      This invitation will expire in 7 days.
                      <br>
                      If you didn't expect this invitation, you can safely ignore this email.
                    </p>
                  </td>
                </tr>

                <!-- Disclaimer -->
                <tr>
                  <td style="padding: 0 20px 20px 20px;">
                     <p style="margin: 0; font-family: 'Inter', Arial, sans-serif; font-size: 14px; color: #919191; line-height: 1.5;">
                      Didn't sign up for this? You can safely ignore this email and your account will not be created.
                    </p>
                  </td>
                </tr>


               <!-- Footer Section -->
                    <tr>
                      <td style="padding: 20px 20px 40px;">
                        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f7f7f7;">
                          
                        <!-- Social Icons -->
                          <tr>
                            <td align="center" style="padding: 20px 0 0;">
                              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                                <tr>
                                  <td style="padding: 0 15px;"><a href="https://www.instagram.com/cultcreativeasia/" target="_blank"><img src="https://drive.google.com/uc?id=18U5OsbRLVFGBXpG3Tod3_E_V-CKCoPxn" alt="Instagram" width="28"></a></td>
                                  <td style="padding: 0 15px;"><a href="https://www.linkedin.com/company/cultcreativeapp/" target="_blank"><img src="https://drive.google.com/uc?id=1-OLY5OezbzS7m37xcfLNXvmJyoNhAtTL" alt="LinkedIn" width="28"></a></td>
                                  <td style="padding: 0 15px;"><a href="https://www.cultcreative.asia" target="_blank"><img src="https://drive.google.com/uc?id=1L5rZbPbK3zouf40Krj-CRtmMa94qc_sP" alt="Website" width="28"></a></td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                          
                          <!-- Email Link -->
                          <tr>
                            <td align="center">
                              <a href="mailto:hello@cultcreative.asia" style="font-family: Arial, sans-serif; font-size: 14px; color: #333333; text-decoration: underline; font-weight: bold;">hello@cultcreative.asia</a>
                            </td>
                          </tr>
                          <!-- Company Info -->
                          <tr>
                            <td align="center">
                              <p style="padding: 20px; margin: 0; font-family: Arial, sans-serif; font-size: 11px; color: #aaaaaa; line-height: 1.5; text-decoration: none">
                                Cult Creative Sdn. Bhd.<br>
                                A-5-3A, Block A, Jaya One, Jln Profesor Diraja Ungku Aziz,<br>
                                Seksyen 13, 46200 Petaling Jaya, Selangor, Malaysia<br>
                                Copyright © ${new Date().getFullYear()} Cult Creative, All rights reserved
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
              </table>
            </td>
          </tr>
        </table>
    </body>
        `,
    };

    sendEmail(emailContent).catch((emailError) => {
      console.error('Error sending invitation email:', emailError);
      return res.status(500).json({ message: 'Failed to send invitation email' });
    });

    return res.status(200).json({ message: 'Invitation resent successfully' });
  } catch (error) {
    console.error('Error resending invitation:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Grant access for a child account (reactivate and restore campaign access)
export const grantAccess = async (req: Request, res: Response) => {
  try {
    const { childAccountId } = req.params;
    console.log('Granting access for child account ID:', childAccountId);

    const childAccount = await prisma.childAccount.findUnique({
      where: { id: childAccountId },
      include: {
        parentClient: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!childAccount) {
      return res.status(404).json({ message: 'Child account not found' });
    }

    // Find the user record for this child account
    const childUser = await prisma.user.findUnique({
      where: { email: childAccount.email },
    });

    if (childUser) {
      // Reactivate the user account
      await prisma.user.update({
        where: { id: childUser.id },
        data: {
          isActive: true,
        },
      });

      // Get all campaigns that the parent client has access to
      const parentCampaigns = await prisma.campaignAdmin.findMany({
        where: {
          adminId: childAccount.parentClient.userId, // Parent client's user ID
        },
        include: {
          campaign: true,
        },
      });

      console.log(`Found ${parentCampaigns.length} campaigns for parent client`);

      // Add child account to all parent's campaigns
      for (const campaignAdmin of parentCampaigns) {
        try {
          await prisma.campaignAdmin.create({
            data: {
              adminId: childUser.id, // Child account user ID
              campaignId: campaignAdmin.campaignId,
            },
          });
          console.log(`Added child account to campaign: ${campaignAdmin.campaignId}`);
        } catch (error) {
          // If already exists, that's fine
          if (error.code === 'P2002') {
            console.log(`Child account already has access to campaign: ${campaignAdmin.campaignId}`);
          } else {
            console.error(`Error adding child account to campaign ${campaignAdmin.campaignId}:`, error);
          }
        }
      }

      // Reactivate the child account
      await prisma.childAccount.update({
        where: { id: childAccountId },
        data: {
          isActive: true,
        },
      });

      console.log(
        `Granted access to child account ${childAccount.email} and added to ${parentCampaigns.length} campaigns`,
      );
    } else {
      // If no user record exists, just reactivate the child account
      await prisma.childAccount.update({
        where: { id: childAccountId },
        data: {
          isActive: true,
        },
      });
    }

    return res.status(200).json({ message: 'Access granted successfully' });
  } catch (error) {
    console.error('Error granting access:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Remove access for a child account (deactivate and remove from all campaigns)
export const removeAccess = async (req: Request, res: Response) => {
  try {
    const { childAccountId } = req.params;
    console.log('Removing access for child account ID:', childAccountId);

    const childAccount = await prisma.childAccount.findUnique({
      where: { id: childAccountId },
      include: {
        parentClient: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!childAccount) {
      return res.status(404).json({ message: 'Child account not found' });
    }

    // Find the user record for this child account
    const childUser = await prisma.user.findUnique({
      where: { email: childAccount.email },
    });

    if (childUser) {
      // Remove child account from all campaigns
      await prisma.campaignAdmin.deleteMany({
        where: {
          adminId: childUser.id,
        },
      });

      console.log(`Removed child account ${childAccount.email} from all campaigns`);

      // Deactivate the user account
      await prisma.user.update({
        where: { id: childUser.id },
        data: {
          isActive: false,
        },
      });

      // Deactivate the child account
      await prisma.childAccount.update({
        where: { id: childAccountId },
        data: {
          isActive: false,
          // Clear the invitation token to prevent reactivation
          invitationToken: null,
          tokenExpiresAt: null,
        },
      });

      console.log(`Deactivated child account ${childAccount.email} and user account`);
    } else {
      // If no user record exists, just deactivate the child account
      await prisma.childAccount.update({
        where: { id: childAccountId },
        data: {
          isActive: false,
          invitationToken: null,
          tokenExpiresAt: null,
        },
      });
    }

    return res.status(200).json({ message: 'Access removed successfully' });
  } catch (error) {
    console.error('Error removing access:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Delete a child account
export const deleteChildAccount = async (req: Request, res: Response) => {
  try {
    const { childAccountId } = req.params;
    console.log('Deleting child account ID:', childAccountId);

    const childAccount = await prisma.childAccount.findUnique({
      where: { id: childAccountId },
    });

    if (!childAccount) {
      return res.status(404).json({ message: 'Child account not found' });
    }

    await prisma.childAccount.delete({
      where: { id: childAccountId },
    });

    return res.status(200).json({ message: 'Child account deleted successfully' });
  } catch (error) {
    console.error('Error deleting child account:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get child account by invitation token (for setup page)
export const getChildAccountByToken = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const childAccount = await prisma.childAccount.findUnique({
      where: { invitationToken: token },
      include: {
        parentClient: {
          include: {
            company: true,
          },
        },
      },
    });

    if (!childAccount) {
      return res.status(404).json({ message: 'Invalid or expired invitation token' });
    }

    // Check if token is expired
    if (childAccount.tokenExpiresAt && new Date() > childAccount.tokenExpiresAt) {
      return res.status(400).json({ message: 'Invitation token has expired' });
    }

    return res.status(200).json(childAccount);
  } catch (error) {
    console.error('Error fetching child account by token:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Activate child account (set password)
export const activateChildAccount = async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    console.log('=== CHILD ACCOUNT ACTIVATION STARTED ===');
    console.log('Activating child account with token:', token);
    console.log('Password provided:', !!password);
    console.log('Request body:', req.body);

    const childAccount = await prisma.childAccount.findUnique({
      where: { invitationToken: token },
    });

    console.log('Found child account:', childAccount ? 'Yes' : 'No');
    if (childAccount) {
      console.log('Child account details:', {
        id: childAccount.id,
        email: childAccount.email,
        isActive: childAccount.isActive,
        tokenExpiresAt: childAccount.tokenExpiresAt,
      });
    }

    if (!childAccount) {
      console.log('Child account not found for token:', token);
      return res.status(404).json({ message: 'Invalid or expired invitation token' });
    }

    // Check if token is expired
    if (childAccount.tokenExpiresAt && new Date() > childAccount.tokenExpiresAt) {
      return res.status(400).json({ message: 'Invitation token has expired' });
    }

    // Check if already activated
    if (childAccount.isActive) {
      return res.status(400).json({ message: 'Account is already activated' });
    }

    const hashedPassword = password;

    // Update child account and create User record
    console.log('Updating child account with ID:', childAccount.id);

    // First, get the parent client to get the company info
    const parentClient = await prisma.client.findUnique({
      where: { id: childAccount.parentClientId },
      include: { company: true },
    });

    if (!parentClient) {
      return res.status(404).json({ message: 'Parent client not found' });
    }

    // Create user first
    const user = await prisma.user.create({
      data: {
        email: childAccount.email,
        password: hashedPassword,
        name: `${childAccount.firstName || ''} ${childAccount.lastName || ''}`.trim(),
        role: 'client' as any,
        status: 'active' as any,
      },
    });

    // Create client record for the child account
    const childClient = await prisma.client.create({
      data: {
        userId: user.id,
        companyId: parentClient.companyId, // Same company as parent
        clientType: 'directClient',
        isActive: true,
      },
    });

    // Create Admin record for campaign access
    const admin = await prisma.admin.create({
      data: {
        userId: user.id,
        mode: 'normal',
      },
    });

    console.log('✅ Admin record created for child account:', admin.id);

    // Get all campaigns that the parent client has access to
    const parentCampaigns = await prisma.campaignAdmin.findMany({
      where: {
        adminId: parentClient.userId, // Parent client's user ID
      },
      include: {
        campaign: true,
      },
    });

    console.log(`Found ${parentCampaigns.length} campaigns for parent client`);

    // Add child account to all parent's campaigns
    for (const campaignAdmin of parentCampaigns) {
      try {
        await prisma.campaignAdmin.create({
          data: {
            adminId: user.id, // Child account user ID
            campaignId: campaignAdmin.campaignId,
          },
        });
        console.log(`Added child account to campaign: ${campaignAdmin.campaignId}`);
      } catch (error) {
        // If already exists, that's fine
        if (error.code === 'P2002') {
          console.log(`Child account already has access to campaign: ${campaignAdmin.campaignId}`);
        } else {
          console.error(`Error adding child account to campaign ${campaignAdmin.campaignId}:`, error);
        }
      }
    }

    // Update child account
    const updatedAccount = await prisma.childAccount.update({
      where: { id: childAccount.id },
      data: {
        password: hashedPassword,
        isActive: true,
        activatedAt: new Date(),
        invitationToken: null, // Clear the token
        tokenExpiresAt: null,
      },
    });

    console.log('Child account updated successfully:', updatedAccount.id);
    console.log('User created successfully:', user.id);
    console.log(`Child account added to ${parentCampaigns.length} campaigns`);
    return res.status(200).json({ message: 'Account activated successfully' });
  } catch (error) {
    console.error('Error activating child account:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
