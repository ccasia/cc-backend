import { Task } from '@prisma/client';

export interface Columns {
  columnId: string;
  tasks: [Task];
  allTasks?: [Task];
  type?: string;
}
