import { openNodeDb } from '../src/drivers/node.ts';
import { initDatabase } from '../src/services/seed/index.ts';

export async function freshDb() {
  const handle = openNodeDb(':memory:');
  await initDatabase(handle.db);
  return handle.db;
}
