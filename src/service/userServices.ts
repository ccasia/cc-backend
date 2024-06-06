/* eslint-disable no-unused-vars */
import { Designation, Mode, Modules, Permissions, PrismaClient } from '@prisma/client';
// import { AdminInvite } from 'src/config/nodemailer.config';
import jwt, { Secret } from 'jsonwebtoken';
import bcrypt from 'bcrypt';

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
  { userId, name, email, designation, country, phoneNumber, status, mode }: AdminProfile,
  permissions: Permission[],
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
            designation: designation as Designation,
            mode: mode as Mode,
          },
        },
      },
      include: {
        admin: {
          include: {
            AdminPermissionModule: true,
          },
        },
      },
    });

    if (permissions.length < 1) {
      await prisma.adminPermissionModule.deleteMany({
        where: {
          adminId: data?.admin?.id,
        },
      });
    }

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

    for (const permission of permissions) {
      // Check if module is already exists

      let module = await prisma.module.findFirst({
        where: { name: permission.module as Modules },
      });

      if (!module) {
        module = await prisma.module.create({
          data: {
            name: permission.module as Modules,
          },
        });
      }

      for (const item of permission.permissions) {
        await prisma.permission.findFirst({
          where: { name: item as Permissions },
        });

        if (!permission) {
          await prisma.permission.create({
            data: {
              name: item as Permissions,
            },
          });
        }
      }

      // Get all permission from database based on data
      const currectPermissions = await prisma.permission.findMany({
        where: {
          name: { in: permission.permissions as any },
        },
      });

      const currentPermissionsForEachModule = await prisma.adminPermissionModule.findMany({
        where: {
          adminId: data?.admin?.id,
          moduleId: module?.id as any,
        },
        include: {
          permission: true,
          module: true,
        },
      });

      const permissionsToRemove = currentPermissionsForEachModule.filter(
        (perm) => !permission.permissions.includes(perm.permission.name as any),
      );

      for (const perm of permissionsToRemove) {
        await prisma.adminPermissionModule.delete({
          where: {
            id: perm.id,
          },
        });
      }

      // extract permission
      const pe = await prisma.permission.findMany();

      // console.log('CURRENT PERMISSION', currectPermissions);

      let permissionsToAdd = pe.filter((elem) => currectPermissions.some((ha) => ha.id === elem.id));

      permissionsToAdd = permissionsToAdd.filter((elem) =>
        currentPermissionsForEachModule.every((item) => item.permissionId !== elem.id),
      );

      for (const perm of permissionsToAdd) {
        await prisma.adminPermissionModule.create({
          data: {
            adminId: data?.admin?.id as any,
            moduleId: module.id,
            permissionId: perm.id,
          },
        });
      }
    }

    return data;
  } catch (error) {
    console.log(error);
    return error;
  }
};

export const getUser = async (id: string) => {
  const user = await prisma.user.findUnique({
    where: {
      id,
    },
    include: {
      admin: {
        include: {
          AdminPermissionModule: {
            select: {
              permission: true,
              module: true,
            },
          },
        },
      },
      creator: {
        include: {
          industries: true,
          interests: true,
        },
      },
    },
  });

  return user;
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
            AdminPermissionModule: {
              select: {
                permission: true,
                module: true,
              },
            },
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
        email,
        phoneNumber,
        country,
        role: 'admin',
        status: 'pending',
      },
    });
    const inviteToken = jwt.sign({ id: user?.id }, process.env.SESSION_SECRET as Secret, { expiresIn: '1h' });

    const admin = await prisma.admin.create({
      data: {
        userId: user.id,
        designation: designation as Designation,
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

export const createNewAdmin = async (email: string, permissions: Permission[]) => {
  try {
    const user = await prisma.user.create({
      data: {
        email: email,
        role: 'admin',
      },
    });

    const inviteToken = jwt.sign({ id: user?.id }, process.env.SESSION_SECRET as Secret, { expiresIn: '1h' });

    const admin = await prisma.admin.create({
      data: {
        userId: user.id,
        inviteToken: inviteToken,
        designation: 'CSM',
      },
    });

    for (const item of permissions) {
      let module = await prisma.module.findFirst({
        where: { name: item.module as Modules },
      });

      module = await prisma.module.create({
        data: {
          name: item.module as Modules,
        },
      });

      for (const entry of item.permissions) {
        let permission = await prisma.permission.findFirst({
          where: { name: entry as Permissions },
        });

        if (!permission) {
          permission = await prisma.permission.create({
            data: {
              name: entry as Permissions,
            },
          });
        }

        await prisma.adminPermissionModule.create({
          data: {
            moduleId: module.id,
            permissionId: permission?.id as string,
            adminId: admin.id,
          },
        });

        const existingModulePermission = await prisma.adminPermissionModule.findFirst({
          where: {
            moduleId: module.id,
            permissionId: permission.id,
            adminId: admin.id,
          },
        });

        if (!existingModulePermission) {
          await prisma.adminPermissionModule.create({
            data: {
              moduleId: module.id,
              permissionId: permission.id,
              adminId: admin.id,
            },
          });
        }
      }
    }

    return { user, admin };
  } catch (error) {
    console.log(error);
    throw new Error(error as any);
  }
};

export const findUserByEmail = async (email: string) => {
  const user = await prisma.user.findUnique({
    where: {
      email: email,
    },
  });
  return user;
};

export const updateNewAdmin = async (adminData: any) => {
  const {
    data: { name, designation, country, phoneNumber, password },
    userId,
  } = adminData;

  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const res = await prisma.$transaction([
      prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          password: hashedPassword,
          status: 'active',
          name,
          country,
          phoneNumber,
        },
      }),
      prisma.admin.update({
        where: {
          userId: userId,
        },
        data: {
          designation,
          inviteToken: null,
        },
      }),
    ]);
    return res;
  } catch (error) {
    throw new Error(error as string);
  }
};
