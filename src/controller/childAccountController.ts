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
      select: { companyId: true }
    });

    if (!currentClient) {
      return res.status(404).json({ message: 'Client not found' });
    }

    // Get all clients in the same company
    const companyClients = await prisma.client.findMany({
      where: { companyId: currentClient.companyId },
      select: { id: true }
    });

    const companyClientIds = companyClients.map(client => client.id);

    // Fetch all child accounts for all clients in the same company
    const childAccounts = await prisma.childAccount.findMany({
      where: {
        parentClientId: {
          in: companyClientIds
        }
      },
      include: {
        parentClient: {
          include: {
            user: {
              select: {
                email: true
              }
            }
          }
        }
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
    });

    if (!parentClient) {
      console.log('Parent client not found for ID:', clientId);
      return res.status(404).json({ message: 'Parent client not found' });
    }

    console.log('Parent client found:', parentClient.id);

    // Check if email already exists
    const existingChildAccount = await prisma.childAccount.findUnique({
      where: { email },
    });

    if (existingChildAccount) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    // Check if email is already a user
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ message: 'Email is already registered as a user' });
    }

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
    const parentClientWithDetails = await prisma.client.findUnique({
      where: { id: clientId },
      include: {
        user: true,
        company: true,
      },
    });

    if (parentClientWithDetails) {
      const baseUrl = process.env.BASE_EMAIL_URL || 'http://localhost:3000';
      const invitationLink = `${baseUrl}/auth/child-account-setup/${invitationToken}`;
      
      console.log('BASE_EMAIL_URL:', process.env.BASE_EMAIL_URL);
      console.log('Generated invitation link:', invitationLink);
      
      const emailContent = {
        to: email,
        subject: `Invitation to join ${parentClientWithDetails.company?.name || 'Client Account'}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>You've been invited to join ${parentClientWithDetails.company?.name || 'Client Account'}</h2>
            <p>Hello ${firstName || ''},</p>
            <p>You have been invited to join the client account for <strong>${parentClientWithDetails.company?.name || 'Client Account'}</strong>.</p>
            <p>Click the link below to set up your account and start collaborating:</p>
            <a href="${invitationLink}" style="background-color: #203ff5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0;">
              Set Up Account
            </a>
            <p>This invitation will expire in 7 days.</p>
            <p>If you didn't expect this invitation, you can safely ignore this email.</p>
          </div>
        `,
      };

      try {
        await sendEmail(emailContent);
      } catch (emailError) {
        console.error('Error sending invitation email:', emailError);
        // Don't fail the request if email fails
      }
    }

    return res.status(201).json({
      message: 'Child account invitation sent successfully',
      childAccount,
    });
  } catch (error) {
    console.error('Error creating child account:', error);
    return res.status(500).json({ message: 'Internal server error' });
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
    const baseUrl = process.env.BASE_EMAIL_URL || 'http://localhost:3000';
    const invitationLink = `${baseUrl}/auth/child-account-setup/${invitationToken}`;
    
    const emailContent = {
      to: childAccount.email,
      subject: `Invitation to join ${childAccount.parentClient.company?.name || 'Client Account'}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>You've been invited to join ${childAccount.parentClient.company?.name || 'Client Account'}</h2>
          <p>Hello ${childAccount.firstName || ''},</p>
          <p>You have been invited to join the client account for <strong>${childAccount.parentClient.company?.name || 'Client Account'}</strong>.</p>
          <p>Click the link below to set up your account and start collaborating:</p>
          <a href="${invitationLink}" style="background-color: #203ff5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0;">
            Set Up Account
          </a>
          <p>This invitation will expire in 7 days.</p>
          <p>If you didn't expect this invitation, you can safely ignore this email.</p>
        </div>
      `,
    };

    try {
      await sendEmail(emailContent);
    } catch (emailError) {
      console.error('Error sending invitation email:', emailError);
      return res.status(500).json({ message: 'Failed to send invitation email' });
    }

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
            user: true
          }
        }
      }
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

      console.log(`Granted access to child account ${childAccount.email} and added to ${parentCampaigns.length} campaigns`);
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
            user: true
          }
        }
      }
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
        tokenExpiresAt: childAccount.tokenExpiresAt
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
      include: { company: true }
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
