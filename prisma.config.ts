import 'dotenv/config';
import path from 'path';

import { defineConfig } from 'prisma/config';

// Prisma stops auto-loading .env once this file exists, hence the dotenv import above.
// The datasource URL still lives in prisma/schema.prisma.
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
});
