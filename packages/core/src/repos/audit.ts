import type { Db } from '../db/driver.ts';
import { nowIso } from '../db/util.ts';

export interface AuditEntry {
  id: number;
  at: string;
  tool: string;
  args: string;
  entityType: string | null;
  entityId: string | null;
}

/** Trace une écriture faite par Claude via le serveur MCP. */
export async function logMcpWrite(db: Db, tool: string, args: unknown, entityType: string | null = null, entityId: string | null = null): Promise<void> {
  await db.execute('INSERT INTO mcp_audit (at, tool, args, entity_type, entity_id) VALUES (?, ?, ?, ?, ?)', [
    nowIso(), tool, JSON.stringify(args), entityType, entityId,
  ]);
}

export async function listMcpAudit(db: Db, limit = 50): Promise<AuditEntry[]> {
  const rows = await db.select<Record<string, any>>('SELECT * FROM mcp_audit ORDER BY id DESC LIMIT ?', [limit]);
  return rows.map((r) => ({ id: r.id, at: r.at, tool: r.tool, args: r.args, entityType: r.entity_type, entityId: r.entity_id }));
}
