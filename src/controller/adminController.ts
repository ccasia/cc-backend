import { Request, Response } from 'express';
import { handleDeleteAdminById } from 'src/service/adminService';

export const deleteAdminById = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    await handleDeleteAdminById(id);
  } catch (err) {
    return res.status(400).json({ message: err });
  }
};
