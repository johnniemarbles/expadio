import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { activateLearningModule } from '@expadio/postgres-runtime/product-module';
import {
  completeMyLearningLesson,
  createLearningEnrollment,
  createLearningLearner,
  listMyLearningEnrollments,
} from '@expadio/postgres-runtime/learning-enrollment';
import {
  createLearningCourse,
  publishLearningCourseVersion,
} from '@expadio/postgres-runtime/learning';
import {
  createLearningAutomationRule,
  updateLearningAutomationRule,
} from '@expadio/postgres-runtime/learning-automation';
import { appendDomainEventWithOutbox } from '@expadio/postgres-runtime/domain-events';
import { executeGovernedCreateTaskAction } from '../lib/governed-create-task-executor';
import {
  processOneDomainEventActionWorkItem,
  type DomainEventActionWorkerResult,
} from '../lib/domain-event-action-worker';
import {
  materializeLearningGovernedActionsForEvent,
} from '../lib/learning-governed-actions';

function pool(): pg.Pool {
  return new pg.Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'expadio_test',
    max: 1,
  });
}

async function tx<T>(client: pg.PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function runUntilEvent(
  client: pg.PoolClient,
  input: {
    readonly tenantId: string;
    readonly eventId: string;
    readonly start: Date;
  },
): Promise<Extract<DomainEventActionWorkerResult, { status: 'PUBLISHED' }>> {
  for (let index = 0; index < 40; index += 1) {
    const result = await processOneDomainEventActionWorkItem(client, {
      tenantId: input.tenantId,
      now: () => new Date(input.start.getTime() + index * 1000),
    });
    if (result.status === 'IDLE') {
      throw new Error('LEARNING_AUTOMATION_TARGET_EVENT_NOT_PROCESSED');
    }
    if (result.status !== 'PUBLISHED') {
      throw new Error(
        `LEARNING_AUTOMATION_WORKER_${result.status}:${result.reason}`,
      );
    }
    if (result.claim.eventId === input.eventId) return result;
  }
  throw new Error('LEARNING_AUTOMATION_WORKER_LIMIT_EXCEEDED');
}

test('Learning event uses shared governed action worker and suspends side effects with entitlement', async () => {
  const p = pool();
  const c = await p.connect();

  try {
    const tenantId = randomUUID();
    const organizationId = randomUUID();
    const learnerSubject = 'automation-learner-' + randomUUID();
    const issuer = 'https://clerk.expadio.com';

    await c.query(
      `INSERT INTO platform.tenants (tenant_id, name, vertical_key)
       VALUES ($1::uuid, 'Learning Automation Tenant', 'dentex')`,
      [tenantId],
    );
    await c.query(
      `INSERT INTO platform.organizations (
         organization_id, tenant_id, name
       ) VALUES ($1::uuid, $2::uuid, 'Learning Automation Org')`,
      [organizationId, tenantId],
    );
    await c.query(
      `INSERT INTO platform.memberships (
         tenant_id, organization_id, subject_id, actor_kind, issuer, status
       ) VALUES ($1::uuid, $2::uuid, $3, 'user', $4, 'ACTIVE')`,
      [tenantId, organizationId, learnerSubject, issuer],
    );
    await c.query(
      `INSERT INTO platform.tenant_module_entitlements (
         tenant_id, module_key, source_type, source_key, status
       ) VALUES ($1::uuid, 'learning', 'PLAN', 'itest-learning-automation', 'ACTIVE')`,
      [tenantId],
    );
    await c.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);

    await tx(c, () =>
      activateLearningModule(c, {
        tenantId,
        actorSubjectId: 'learning-admin',
        correlationId: 'learning-automation-activate-itest',
      }),
    );

    const course = await tx(c, () =>
      createLearningCourse(c, {
        tenantId,
        actorSubjectId: 'learning-admin',
        correlationId: 'learning-automation-course-create-itest',
        courseKey: 'automation.privacy.course',
        draft: {
          title: 'Automation Privacy Course',
          language: 'en-CA',
          visibility: 'TENANT',
          learningObjectives: ['Complete governed learning follow-up'],
          modules: [
            {
              moduleKey: 'privacy',
              title: 'Privacy',
              position: 1,
              lessons: [
                {
                  lessonKey: 'foundation',
                  title: 'Foundation',
                  activityType: 'TEXT',
                  position: 1,
                  required: true,
                  estimatedMinutes: 5,
                  content: { body: 'Privacy.' },
                },
              ],
            },
          ],
        },
      }),
    );

    await tx(c, () =>
      publishLearningCourseVersion(c, {
        tenantId,
        courseId: course.courseId,
        version: 1,
        actorSubjectId: 'learning-admin',
        correlationId: 'learning-automation-course-publish-itest',
      }),
    );

    const learner = await tx(c, () =>
      createLearningLearner(c, {
        tenantId,
        actorSubjectId: 'learning-admin',
        learner: {
          subjectId: learnerSubject,
          fullName: 'Automation Learner',
          email: 'automation.learner@example.test',
          audienceType: 'INTERNAL',
        },
      }),
    );

    const enrollment = await tx(c, () =>
      createLearningEnrollment(c, {
        tenantId,
        actorSubjectId: 'learning-admin',
        correlationId: 'learning-automation-enroll-itest',
        enrollment: {
          assignmentKey: 'manual:automation:' + learner.learnerId,
          learnerId: learner.learnerId,
          courseId: course.courseId,
          sourceType: 'MANUAL',
        },
      }),
    );

    const rule = await tx(c, () =>
      createLearningAutomationRule(c, {
        tenantId,
        actorSubjectId: 'learning-admin',
        correlationId: 'learning-automation-rule-create-itest',
        ruleKey: 'learning.course.completion.review',
        rule: {
          eventType: 'learning.course.completed',
          executorClass: 'CREATE_TASK',
          actionKey: 'learning.course.completion.review',
          enabled: true,
          policyKeys: [],
          configuration: {
            title: 'Review completed learning',
            description: {
              kind: 'EVENT_PAYLOAD',
              key: 'courseKey',
              required: true,
            },
            assigneeSubjectId: {
              kind: 'AGGREGATE_FIELD',
              key: 'learnerSubjectId',
              required: true,
            },
            dueAt: null,
            priority: 'NORMAL',
          },
        },
      }),
    );
    assert.equal(rule.revision, 1);
    assert.equal(rule.enabled, true);

    const myLearning = await tx(c, () =>
      listMyLearningEnrollments(c, {
        tenantId,
        subjectId: learnerSubject,
        subjectIssuer: issuer,
      }),
    );
    const pinned = myLearning.enrollments.find(
      (item) =>
        item.enrollmentId === enrollment.enrollment.enrollmentId,
    );
    assert.ok(pinned);
    const lessonId = pinned.lessons[0]?.lessonId;
    assert.ok(lessonId);

    await tx(c, () =>
      completeMyLearningLesson(c, {
        tenantId,
        subjectId: learnerSubject,
        subjectIssuer: issuer,
        enrollmentId: pinned.enrollmentId,
        lessonId,
        correlationId: 'learning-automation-course-complete-itest',
      }),
    );

    const completionEvent = await c.query<{ event_id: string }>(
      `SELECT event_id
         FROM platform.domain_events
        WHERE tenant_id = $1::uuid
          AND aggregate_type = 'learning.enrollment'
          AND aggregate_id = $2
          AND event_type = 'learning.course.completed'
        ORDER BY occurred_at DESC, event_id DESC
        LIMIT 1`,
      [tenantId, pinned.enrollmentId],
    );
    const completionEventId = completionEvent.rows[0]?.event_id;
    assert.ok(completionEventId);

    const processed = await runUntilEvent(c, {
      tenantId,
      eventId: completionEventId,
      start: new Date('2026-09-01T02:00:00.000Z'),
    });

    assert.equal(processed.actions.length, 1);
    assert.equal(processed.tasks.length, 1);
    assert.equal(processed.communications.length, 0);
    assert.equal(processed.schedules.length, 0);

    const action = processed.actions[0];
    assert.equal(action?.status, 'PERSISTED');
    if (action?.status !== 'PERSISTED') {
      throw new Error('expected persisted Learning automation action');
    }
    assert.equal(action.intent.executorClass, 'CREATE_TASK');
    assert.equal(action.intent.actionKey, 'learning.course.completion.review');
    assert.equal(action.intent.sourceEventId, completionEventId);
    assert.deepEqual(action.intent.configuration, {
      title: 'Review completed learning',
      description: 'automation.privacy.course',
      assigneeSubjectId: learnerSubject,
      dueAt: null,
      priority: 'NORMAL',
    });

    const taskResult = processed.tasks[0];
    assert.ok(taskResult);
    assert.equal(taskResult.attempt.status, 'SUCCEEDED');
    assert.equal(taskResult.task?.title, 'Review completed learning');
    assert.equal(taskResult.task?.description, 'automation.privacy.course');
    assert.equal(taskResult.task?.assigneeSubjectId, learnerSubject);
    assert.equal(taskResult.task?.aggregateType, 'learning.enrollment');
    assert.equal(taskResult.task?.aggregateId, pinned.enrollmentId);

    const replayMaterialization =
      await materializeLearningGovernedActionsForEvent(c, {
        tenantId,
        eventId: completionEventId,
        now: () => new Date('2026-09-01T02:10:00.000Z'),
      });
    assert.equal(replayMaterialization.length, 1);
    assert.equal(replayMaterialization[0]?.status, 'PERSISTED');
    if (replayMaterialization[0]?.status !== 'PERSISTED') {
      throw new Error('expected replay materialization to return existing intent');
    }
    assert.equal(
      replayMaterialization[0].intent.actionIntentId,
      action.intent.actionIntentId,
    );

    const replayExecution = await executeGovernedCreateTaskAction(c, {
      intent: replayMaterialization[0].intent,
      now: () => new Date('2026-09-01T02:10:01.000Z'),
    });
    assert.equal(replayExecution.replayed, true);
    assert.equal(replayExecution.task, null);

    const counts = await c.query<{
      intents: number;
      tasks: number;
      attempts: number;
    }>(
      `SELECT
         (
           SELECT count(*)::int
             FROM platform.governed_action_intents
            WHERE tenant_id = $1::uuid
              AND source_event_id = $2::uuid
         ) AS intents,
         (
           SELECT count(*)::int
             FROM platform.operational_tasks
            WHERE tenant_id = $1::uuid
              AND source_event_id = $2::uuid
         ) AS tasks,
         (
           SELECT count(*)::int
             FROM platform.governed_action_execution_attempts attempt
             JOIN platform.governed_action_intents intent
               ON intent.tenant_id = attempt.tenant_id
              AND intent.action_intent_id = attempt.action_intent_id
            WHERE attempt.tenant_id = $1::uuid
              AND intent.source_event_id = $2::uuid
         ) AS attempts`,
      [tenantId, completionEventId],
    );
    assert.deepEqual(counts.rows[0], {
      intents: 1,
      tasks: 1,
      attempts: 1,
    });

    const disabled = await tx(c, () =>
      updateLearningAutomationRule(c, {
        tenantId,
        automationRuleId: rule.automationRuleId,
        expectedRevision: 1,
        actorSubjectId: 'learning-admin',
        correlationId: 'learning-automation-rule-disable-itest',
        rule: {
          eventType: 'learning.course.completed',
          executorClass: 'CREATE_TASK',
          actionKey: 'learning.course.completion.review',
          enabled: false,
          policyKeys: [],
          configuration: rule.configuration,
        },
      }),
    );
    assert.equal(disabled.revision, 2);
    assert.equal(disabled.enabled, false);

    await assert.rejects(
      () =>
        tx(c, () =>
          updateLearningAutomationRule(c, {
            tenantId,
            automationRuleId: rule.automationRuleId,
            expectedRevision: 1,
            actorSubjectId: 'learning-admin',
            correlationId: 'learning-automation-stale-update-itest',
            rule: {
              eventType: 'learning.course.completed',
              executorClass: 'CREATE_TASK',
              actionKey: 'learning.course.completion.review',
              enabled: true,
              policyKeys: [],
              configuration: rule.configuration,
            },
          }),
        ),
      /LEARNING_AUTOMATION_RULE_REVISION_CONFLICT/,
    );

    const noActionWhenDisabled =
      await materializeLearningGovernedActionsForEvent(c, {
        tenantId,
        eventId: completionEventId,
      });
    assert.deepEqual(noActionWhenDisabled, []);

    const reenabled = await tx(c, () =>
      updateLearningAutomationRule(c, {
        tenantId,
        automationRuleId: rule.automationRuleId,
        expectedRevision: 2,
        actorSubjectId: 'learning-admin',
        correlationId: 'learning-automation-rule-reenable-itest',
        rule: {
          eventType: 'learning.course.completed',
          executorClass: 'CREATE_TASK',
          actionKey: 'learning.course.completion.review',
          enabled: true,
          policyKeys: [],
          configuration: rule.configuration,
        },
      }),
    );
    assert.equal(reenabled.revision, 3);
    assert.equal(reenabled.enabled, true);

    await c.query(
      `UPDATE platform.tenant_module_entitlements
          SET status = 'REVOKED'
        WHERE tenant_id = $1::uuid
          AND module_key = 'learning'
          AND source_key = 'itest-learning-automation'`,
      [tenantId],
    );

    const suspendedMaterialization =
      await materializeLearningGovernedActionsForEvent(c, {
        tenantId,
        eventId: completionEventId,
      });
    assert.deepEqual(suspendedMaterialization, []);

    const suspendedEventId = randomUUID();
    await tx(c, () =>
      appendDomainEventWithOutbox(c, {
        event: {
          eventId: suspendedEventId,
          tenantId,
          aggregateType: 'learning.enrollment',
          aggregateId: pinned.enrollmentId,
          eventType: 'learning.course.completed',
          eventVersion: 1,
          occurredAt: new Date('2026-09-01T03:00:00.000Z'),
          actorSubjectId: learnerSubject,
          correlationId: 'learning-automation-suspended-event-itest',
          payload: {
            learnerId: learner.learnerId,
            courseId: course.courseId,
            courseKey: 'automation.privacy.course',
            courseVersionId: pinned.courseVersionId,
            courseVersion: pinned.courseVersion,
            completionPercent: 100,
          },
          metadata: { source: 'learning.automation.suspension-proof' },
        },
      }),
    );

    const suspendedProcessed = await runUntilEvent(c, {
      tenantId,
      eventId: suspendedEventId,
      start: new Date('2026-09-01T03:01:00.000Z'),
    });
    assert.deepEqual(suspendedProcessed.actions, []);
    assert.deepEqual(suspendedProcessed.tasks, []);
    assert.equal(suspendedProcessed.status, 'PUBLISHED');

    const finalTaskCount = await c.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM platform.operational_tasks
        WHERE tenant_id = $1::uuid
          AND action_key IS NULL`,
      [tenantId],
    ).catch(async () =>
      c.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM platform.operational_tasks
          WHERE tenant_id = $1::uuid`,
        [tenantId],
      ),
    );
    assert.equal(finalTaskCount.rows[0]?.count, 1);
  } finally {
    c.release();
    await p.end();
  }
});
