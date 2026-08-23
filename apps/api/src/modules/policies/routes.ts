import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import {
  AuditAction,
  Role,
  updatePolicySchema,
  upsertAppCategorySchema,
} from '@workpulse/shared';
import { collections } from '../../db/client.js';
import { adminOf } from '../../plugins/auth.js';
import { normalizeExeName } from '../activity/categorize.js';
import { recordAudit } from '../audit/service.js';
import * as policyService from './service.js';

export async function policyRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: app.requireAdmin }, async (request) => {
    return policyService.getPolicy(adminOf(request).organizationId);
  });

  /**
   * Changing collection policy is the single most privileged action in the
   * product — it decides what every endpoint in the organization records —
   * so it requires ORG_OWNER and is always audited with a before/after diff.
   */
  app.patch('/', { preHandler: app.requireRole(Role.OrgOwner) }, async (request) => {
    const admin = adminOf(request);
    const body = updatePolicySchema.parse(request.body);

    const before = await policyService.getPolicy(admin.organizationId);
    const after = await policyService.updatePolicy(admin.organizationId, body, admin.userId);

    const changed = Object.keys(body).filter(
      (key) => before[key as keyof typeof before] !== after[key as keyof typeof after],
    );

    await recordAudit(request, admin, {
      action: AuditAction.PolicyUpdated,
      targetType: 'policy',
      targetId: admin.organizationId,
      metadata: {
        changed,
        before: Object.fromEntries(changed.map((k) => [k, before[k as keyof typeof before]])),
        after: Object.fromEntries(changed.map((k) => [k, after[k as keyof typeof after]])),
      },
    });

    return after;
  });

  // -------------------------------------------------------------------------
  // Application categories (spec §15)
  // -------------------------------------------------------------------------

  app.get('/categories', { preHandler: app.requireAdmin }, async (request) => {
    const admin = adminOf(request);

    const rules = await collections
      .appCategories()
      .find({ organizationId: admin.organizationId })
      .sort({ displayName: 1 })
      .toArray();

    return {
      rules: rules.map((rule) => ({
        id: rule._id.toHexString(),
        exeName: rule.exeName,
        displayName: rule.displayName,
        category: rule.category,
      })),
    };
  });

  app.put('/categories', { preHandler: app.requireRole(Role.HrAdmin) }, async (request) => {
    const admin = adminOf(request);
    const body = upsertAppCategorySchema.parse(request.body);
    const exeName = normalizeExeName(body.exeName);
    const now = new Date();

    await collections.appCategories().updateOne(
      { organizationId: admin.organizationId, exeName },
      {
        $set: { displayName: body.displayName, category: body.category, updatedAt: now },
        $setOnInsert: { _id: new ObjectId(), organizationId: admin.organizationId, exeName },
      },
      { upsert: true },
    );

    // Existing sessions keep the category they were stored with; re-labelling
    // history would silently rewrite past reports. New sessions pick up the
    // rule, so the change is forward-looking and explainable.
    await recordAudit(request, admin, {
      action: AuditAction.AppCategoryUpdated,
      targetType: 'app_category',
      targetLabel: exeName,
      metadata: { category: body.category },
    });

    return { ok: true, exeName, category: body.category };
  });
}
