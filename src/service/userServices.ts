/* eslint-disable no-unused-vars */
import { Mode, Modules, PrismaClient } from '@prisma/client';
// import { AdminInvite } from '@configs/nodemailer.config';
import jwt, { Secret } from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createKanbanBoard } from '@controllers/kanbanController';
import { uploadProfileImage } from '@configs/cloudStorage.config';

const prisma = new PrismaClient();

interface AdminProfile {
  userId: string;
  name: string;
  email: string;
  password: string;
  designation: string;
  country: string;
  phoneNumber: string;
  role: string;
  mode: string;
  status: any;
}

interface Permission {
  module: '';
  permissions: string[];
}

export const updateAdmin = async (
  { userId, name, email, country, phoneNumber, status, mode, role }: AdminProfile,
  // permissions?: Permission[],
  publicURL?: string | undefined,
) => {
  try {
    const data = await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        name,
        email,
        country,
        phoneNumber,
        photoURL: publicURL,
        status,
        admin: {
          update: {
            mode: mode as Mode,
            roleId: role,
          },
        },
      },
      include: {
        admin: {
          include: {
            adminPermissionModule: true,
          },
        },
      },
    });

    // if (permissions.length < 1) {
    //   await prisma.adminPermissionModule.deleteMany({
    //     where: {
    //       adminId: data?.admin?.id,
    //     },
    //   });
    // }

    // Get all adminmodulepermission
    // const allData = await prisma.adminPermissionModule.findMany({
    //   where: {
    //     adminId: data?.admin?.id,
    //   },
    //   include: {
    //     admin: true,
    //     permission: true,
    //     module: true,
    //   },
    // });
    // if (permissions) {
    //   for (const permission of permissions) {
    //     // Check if module is already exists

    //     let module = await prisma.module.findFirst({
    //       where: { name: permission.module as Modules },
    //     });

    //     if (!module) {
    //       module = await prisma.module.create({
    //         data: {
    //           name: permission.module as Modules,
    //         },
    //       });
    //     }

    //     for (const item of permission.permissions) {
    //       const existingPermission = await prisma.permission.findFirst({
    //         where: { name: item },
    //       });

    //       if (!existingPermission) {
    //         await prisma.permission.create({
    //           data: {
    //             name: item,
    //           },
    //         });
    //       }
    //     }

    //     // Get all permission from database based on data
    //     const currectPermissions = await prisma.permission.findMany({
    //       where: {
    //         name: { in: permission.permissions as any },
    //       },
    //     });

    //     const currentPermissionsForEachModule = await prisma.adminPermissionModule.findMany({
    //       where: {
    //         adminId: data?.admin?.id,
    //         moduleId: module?.id as any,
    //       },
    //       include: {
    //         permission: true,
    //         module: true,
    //       },
    //     });

    //     const permissionsToRemove = currentPermissionsForEachModule.filter(
    //       (perm) => !permission.permissions.includes(perm.permission.name as any),
    //     );

    //     for (const perm of permissionsToRemove) {
    //       await prisma.adminPermissionModule.delete({
    //         where: {
    //           id: perm.id,
    //         },
    //       });
    //     }

    //     // extract permission
    //     const pe = await prisma.permission.findMany();

    //     let permissionsToAdd = pe.filter((elem) => currectPermissions.some((ha) => ha.id === elem.id));

    //     permissionsToAdd = permissionsToAdd.filter((elem) =>
    //       currentPermissionsForEachModule.every((item) => item.permissionId !== elem.id),
    //     );

    //     for (const perm of permissionsToAdd) {
    //       await prisma.adminPermissionModule.create({
    //         data: {
    //           adminId: data?.admin?.id as any,
    //           moduleId: module.id,
    //           permissionId: perm.id,
    //         },
    //       });
    //     }
    //   }
    // }

    return data;
  } catch (error) {
    //console.log(error);
    return error;
  }
};

export const getUser = async (id: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id,
      },
      include: {
        paymentForm: true,
        agreementTemplate: true,
        admin: {
          include: {
            adminPermissionModule: {
              select: {
                permission: true,
                module: true,
              },
            },
            role: {
              include: {
                permissions: true,
              },
            },
          },
        },
        client: true,
        creator: {
          include: {
            interests: true,
            mediaKit: true,
          },
        },
        pitch: true,
        shortlisted: true,
        _count: {
          select: {
            UserThread: true,
          },
        },
      },
    });

    return user;
  } catch (error) {
    throw new Error(error);
  }
};

export const handleGetAdmins = async (userid: string) => {
  try {
    const admins = await prisma.user.findMany({
      where: {
        NOT: {
          id: userid,
        },
        role: 'admin',
      },
      include: {
        admin: {
          include: {
            adminPermissionModule: {
              select: {
                permission: true,
                module: true,
              },
            },
            role: true,
          },
        },
      },
    });

    return admins;
  } catch (error) {
    return error;
  }
};

interface AdminForm {
  name: string;
  email: string;
  phoneNumber: string;
  country: string;
  adminRole: string;
  designation: string;
}

export const createAdminForm = async (data: AdminForm) => {
  const { name, email, phoneNumber, country, designation } = data;

  try {
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        phoneNumber,
        password: '',
        country,
        role: 'admin',
        status: 'pending',
      },
    });

    const inviteToken = jwt.sign({ id: user?.id }, process.env.SESSION_SECRET as Secret, { expiresIn: '1h' });

    const admin = await prisma.admin.create({
      data: {
        userId: user.id,
        inviteToken,
      },
    });

    return { user, admin };
  } catch (error) {
    throw new Error(error as any);
  }
};

// interface Permission {
//   module: string;
//   permission: [];
// }

export const createNewAdmin = async (email: string, role: String) => {
  try {
    const user = await prisma.user.create({
      data: {
        email: email,
        password: '',
        role: 'admin',
      },
    });

    const inviteToken = jwt.sign({ id: user?.id }, process.env.SESSION_SECRET as Secret, { expiresIn: '5m' });

    const admin = await prisma.admin.create({
      data: {
        userId: user.id,
        roleId: role as string,
        inviteToken: inviteToken as string,
      },
    });

    // Setting up permissions
    // for (const item of permissions) {
    //   let module = await prisma.module.findFirst({
    //     where: { name: item.module as Modules },
    //   });

    //   module = await prisma.module.create({
    //     data: {
    //       name: item.module as Modules,
    //     },
    //   });

    //   for (const entry of item.permissions) {
    //     let permission = await prisma.permission.findFirst({
    //       where: { name: entry },
    //     });

    //     if (!permission) {
    //       permission = await prisma.permission.create({
    //         data: {
    //           name: entry,
    //         },
    //       });
    //     }

    //     await prisma.adminPermissionModule.create({
    //       data: {
    //         moduleId: module.id,
    //         permissionId: permission?.id as string,
    //         adminId: admin.id,
    //       },
    //     });

    //     const existingModulePermission = await prisma.adminPermissionModule.findFirst({
    //       where: {
    //         moduleId: module.id,
    //         permissionId: permission.id,
    //         adminId: admin.id,
    //       },
    //     });

    //     if (!existingModulePermission) {
    //       await prisma.adminPermissionModule.create({
    //         data: {
    //           moduleId: module.id,
    //           permissionId: permission.id,
    //           adminId: admin.id,
    //         },
    //       });
    //     }
    //   }
    // }

    return { user, admin };
  } catch (error) {
    //console.log(error);
    throw new Error(error as any);
  }
};

export const findUserByEmail = async (email: string) => {
  const user = await prisma.user.findUnique({
    where: {
      email: email.toLowerCase(),
    },
  });
  return user;
};

export const updateNewAdmin = async (adminData: any, photo?: any) => {
  const {
    data: { name, country, phoneNumber, password },
    userId,
  } = adminData;

  const hashedPassword = await bcrypt.hash(password, 10);
  let url: string;

  try {
    if (photo) {
      url = await uploadProfileImage(photo.tempFilePath, photo.name, 'admin');
    }

    const res = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          password: hashedPassword,
          status: 'active',
          name,
          country,
          phoneNumber,
          photoURL: url,
        },
      });

      const admin = tx.admin.update({
        where: {
          userId: userId,
        },
        data: {
          inviteToken: null,
        },
      });

      return { user, admin };
    });

    await createKanbanBoard(res.user.id);
    return res;
  } catch (error) {
    throw new Error(error as string);
  }
};
