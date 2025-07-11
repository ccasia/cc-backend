import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { uploadCompanyLogo } from '@configs/cloudStorage.config';

const prisma = new PrismaClient();

export const updateClient = async (req: Request, res: Response) => {
  try {
    const userId = req.session.userid;
    
    if (!userId) {
      return res.status(401).json({ message: 'User not authenticated' });
    }

    const {
      companyName,
      companyAddress,
      registrationNumber,
      picName,
      picDesignation,
      picMobile,
      country
    } = JSON.parse(req.body.data);

    // Get user by role client
    const user = await prisma.user.findUnique({
      where: { 
        id: userId,
        role: 'client'
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'Client user not found' });
    }

    // Find company where user's email matches any PIC email
    const companies = await prisma.company.findMany({
      include: { pic: true }
    });
    
    const company = companies.find(comp => 
      comp.pic?.some(pic => pic.email?.toLowerCase() === user.email?.toLowerCase())
    );

    if (!company) {
      return res.status(404).json({ message: 'No company found with matching PIC email' });
    }

    // Handle company logo upload
    let logoURL = company.logo;
    if (req.files && (req.files as { companyLogo: any })?.companyLogo) {
      const logo = (req.files as { companyLogo: any }).companyLogo;
      logoURL = await uploadCompanyLogo(logo.tempFilePath, logo.name);
    }

    // Prepare update data
    const userUpdateData: any = {};
    const companyUpdateData: any = {};

    // Update user data (PIC personal info)
    if (picName) userUpdateData.name = picName;
    if (country) userUpdateData.country = country;
    if (picMobile) userUpdateData.phoneNumber = picMobile;

    // Update company data
    if (companyName) companyUpdateData.name = companyName;
    if (companyAddress) companyUpdateData.address = companyAddress;
    if (registrationNumber) companyUpdateData.registration_number = registrationNumber;
    if (logoURL !== company.logo) companyUpdateData.logo = logoURL;

    // Update PIC designation in company.pic array
    if (picDesignation && company.pic) {
      const currentPic = company.pic.find(pic => pic.email?.toLowerCase() === user.email?.toLowerCase());
      if (currentPic) {
        companyUpdateData.pic = {
          update: {
            where: { id: currentPic.id },
            data: { name: picName,designation: picDesignation }
          }
        };
      }
    }

    // Execute updates in parallel
    const updatePromises = [];

    if (Object.keys(userUpdateData).length > 0) {
      updatePromises.push(
        prisma.user.update({
          where: { id: userId },
          data: userUpdateData
        })
      );
    }

    if (Object.keys(companyUpdateData).length > 0) {
      updatePromises.push(
        prisma.company.update({
          where: { id: company.id },
          data: companyUpdateData
        })
      );
    }

    const [updatedUser, updatedCompany] = await Promise.all(updatePromises);

    return res.status(200).json({
      message: 'Client profile updated successfully',
      data: {
        user: updatedUser,
        company: updatedCompany
      }
    });

  } catch (error: any) {
    console.error('Error updating client profile:', error);
    return res.status(500).json({ 
      message: error.message || 'Internal server error while updating client profile' 
    });
  }
};