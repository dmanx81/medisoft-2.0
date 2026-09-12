import type { QueryRunner } from '@/lib/db/query';
import type { Principal } from '@/lib/auth/permissions';
import type { ReportCompletionBlock } from './types';

export type OrderCompletionState = {
  order_id: string;
  order_status: string;
  complete: boolean;
  blocking: ReportCompletionBlock[];
};

async function audit(
  db: QueryRunner,
  principal: Principal,
  entityType: string,
  id: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  await db.query(
    `INSERT INTO audit_events(organization_id,user_id,action,entity_type,entity_id,metadata,session_hash)
 VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      principal.organizationId,
      principal.userId,
      action,
      entityType,
      id,
      JSON.stringify(metadata),
      principal.sessionHash,
    ],
  );
}

export async function orderCompletionState(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<OrderCompletionState> {
  const order = (
    await db.query<{ id: string; status: string }>(
      `SELECT id,status FROM lab_orders WHERE organization_id=$1 AND id=$2`,
      [principal.organizationId, orderId],
    )
  ).rows[0];
  if (!order)
    return {
      order_id: orderId,
      order_status: '',
      complete: false,
      blocking: [],
    };
  const rows = (
    await db.query<{
      id: string;
      code_snapshot: string;
      name_snapshot: string;
      test_status: string;
      result_id: string;
      result_status: string;
    }>(
      `SELECT t.id,t.code_snapshot,t.name_snapshot,t.status AS test_status,
 COALESCE(r.id::text,'') AS result_id,COALESCE(r.status,'') AS result_status
 FROM lab_order_tests t
 LEFT JOIN lab_results r ON r.organization_id=t.organization_id
  AND r.order_test_id=t.id AND r.is_current
 WHERE t.organization_id=$1 AND t.order_id=$2
 ORDER BY t.created_at,t.id`,
      [principal.organizationId, orderId],
    )
  ).rows;
  const active = rows.filter((row) => row.test_status === 'ACTIVE');
  const blocking: ReportCompletionBlock[] = [];
  for (const row of active) {
    if (!row.result_id)
      blocking.push({
        order_test_id: row.id,
        code: row.code_snapshot,
        name: row.name_snapshot,
        reason: 'NO_RESULT',
      });
    else if (row.result_status !== 'CLINICALLY_VERIFIED')
      blocking.push({
        order_test_id: row.id,
        code: row.code_snapshot,
        name: row.name_snapshot,
        reason: 'NOT_VERIFIED',
      });
  }
  return {
    order_id: order.id,
    order_status: order.status,
    complete: active.length > 0 && blocking.length === 0,
    blocking,
  };
}

export async function evaluateOrderCompletion(
  db: QueryRunner,
  principal: Principal,
  orderId: string,
): Promise<OrderCompletionState> {
  const locked = (
    await db.query<{ id: string; status: string }>(
      `SELECT id,status FROM lab_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [principal.organizationId, orderId],
    )
  ).rows[0];
  if (!locked)
    return {
      order_id: orderId,
      order_status: '',
      complete: false,
      blocking: [],
    };
  const state = await orderCompletionState(db, principal, locked.id);
  if (locked.status !== 'IN_PROCESS' && locked.status !== 'COMPLETED')
    return { ...state, order_status: locked.status };
  if (state.complete && locked.status === 'IN_PROCESS') {
    await db.query(
      `UPDATE lab_orders SET status='COMPLETED',updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='IN_PROCESS'`,
      [principal.organizationId, locked.id, principal.userId],
    );
    await audit(db, principal, 'LAB_ORDER', locked.id, 'LAB_ORDER_COMPLETED', {
      from: 'IN_PROCESS',
      to: 'COMPLETED',
      reason: 'All active ordered tests have a current clinically verified result.',
    });
    return { ...state, order_status: 'COMPLETED' };
  }
  if (!state.complete && locked.status === 'COMPLETED') {
    await db.query(
      `UPDATE lab_orders SET status='IN_PROCESS',updated_by=$3,version=version+1
 WHERE organization_id=$1 AND id=$2 AND status='COMPLETED'`,
      [principal.organizationId, locked.id, principal.userId],
    );
    await audit(db, principal, 'LAB_ORDER', locked.id, 'LAB_ORDER_REOPENED', {
      from: 'COMPLETED',
      to: 'IN_PROCESS',
      reason: 'A current result is no longer clinically verified.',
      blocking: state.blocking.map((row) => row.reason),
    });
    return { ...state, order_status: 'IN_PROCESS' };
  }
  return { ...state, order_status: locked.status };
}
