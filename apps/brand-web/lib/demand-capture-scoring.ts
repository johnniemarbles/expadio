import { createHash } from 'node:crypto';
import type pg from 'pg';
import {
  calculateLeadScore,
  validateLeadScoringProfileDefinition,
  type LeadScoringProfileDefinition,
  type QualificationResponse,
} from './lead-scoring-domain.ts';

interface ProfileRow {
  scoring_profile_id: string;
  organization_id: string;
  profile_key: string;
  version: number;
  components: LeadScoringProfileDefinition['components'];
  band_thresholds: LeadScoringProfileDefinition['bandThresholds'];
}

interface AssessmentRow {
  qualification_id: string;
  criterion_key: string;
  response: QualificationResponse;
  assessed_at: Date | string;
}

export interface PersistedDemandCaptureScore {
  readonly scoreId: string;
  readonly captureLeadId: string;
  readonly scoringProfileId: string;
  readonly profileKey: string;
  readonly profileVersion: number;
  readonly totalScore: number;
  readonly band: string;
  readonly calculationFingerprint: string;
  readonly replayed: boolean;
}

function stableAssessmentFingerprint(input: {
  profileId: string;
  profileVersion: number;
  assessments: readonly AssessmentRow[];
}): string {
  const material = JSON.stringify({
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    assessments: input.assessments.map((assessment) => ({
      qualificationId: assessment.qualification_id,
      criterionKey: assessment.criterion_key,
      response: assessment.response,
      assessedAt: new Date(assessment.assessed_at).toISOString(),
    })),
  });
  return createHash('sha256').update(material).digest('hex');
}

export async function calculateAndPersistDemandCaptureScore(
  client: pg.PoolClient,
  input: {
    readonly tenantId: string;
    readonly captureLeadId: string;
    readonly actorSubjectId: string;
    readonly profileKey?: string;
  },
): Promise<PersistedDemandCaptureScore | null> {
  const lead = await client.query<{ organization_id: string }>(
    `SELECT organization_id
       FROM platform.lead_capture_leads
      WHERE tenant_id = $1::uuid
        AND capture_lead_id = $2::uuid`,
    [input.tenantId, input.captureLeadId],
  );
  const leadRow = lead.rows[0];
  if (!leadRow) return null;

  const profileKey = input.profileKey?.trim() || 'default';
  const profileResult = await client.query<ProfileRow>(
    `SELECT scoring_profile_id, organization_id, profile_key, version,
            components, band_thresholds
       FROM platform.lead_scoring_profiles
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND profile_key = $3
        AND status = 'ACTIVE'
      LIMIT 1`,
    [input.tenantId, leadRow.organization_id, profileKey],
  );
  const profile = profileResult.rows[0];
  if (!profile) throw new Error('LEAD_SCORING_ACTIVE_PROFILE_NOT_FOUND');

  const definition = validateLeadScoringProfileDefinition({
    components: profile.components,
    bandThresholds: profile.band_thresholds,
  });

  const assessmentsResult = await client.query<AssessmentRow>(
    `SELECT DISTINCT ON (criterion_key)
            qualification_id, criterion_key, response, assessed_at
       FROM platform.lead_qualifications
      WHERE tenant_id = $1::uuid
        AND organization_id = $2::uuid
        AND capture_lead_id = $3::uuid
      ORDER BY criterion_key, assessed_at DESC, qualification_id DESC`,
    [input.tenantId, leadRow.organization_id, input.captureLeadId],
  );
  const assessments = [...assessmentsResult.rows]
    .sort((left, right) => left.criterion_key.localeCompare(right.criterion_key));

  const calculated = calculateLeadScore(
    definition,
    assessments.map((assessment) => ({
      criterionKey: assessment.criterion_key,
      response: assessment.response,
    })),
  );
  const fingerprint = stableAssessmentFingerprint({
    profileId: profile.scoring_profile_id,
    profileVersion: profile.version,
    assessments,
  });

  const inserted = await client.query<{ score_id: string }>(
    `INSERT INTO platform.lead_scores (
       tenant_id, organization_id, capture_lead_id, scoring_profile_id,
       profile_version, total_score, band, calculated_by_subject_id,
       calculation_reason, calculation_fingerprint
     ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (
       tenant_id, organization_id, capture_lead_id,
       scoring_profile_id, calculation_fingerprint
     ) WHERE calculation_fingerprint IS NOT NULL
     DO NOTHING
     RETURNING score_id`,
    [
      input.tenantId,
      leadRow.organization_id,
      input.captureLeadId,
      profile.scoring_profile_id,
      profile.version,
      calculated.totalScore,
      calculated.band,
      input.actorSubjectId,
      'Deterministic calculation from latest qualification evidence',
      fingerprint,
    ],
  );

  let scoreId = inserted.rows[0]?.score_id;
  const replayed = !scoreId;
  if (!scoreId) {
    const existing = await client.query<{ score_id: string; total_score: string | number; band: string }>(
      `SELECT score_id, total_score, band
         FROM platform.lead_scores
        WHERE tenant_id = $1::uuid
          AND organization_id = $2::uuid
          AND capture_lead_id = $3::uuid
          AND scoring_profile_id = $4::uuid
          AND calculation_fingerprint = $5
        LIMIT 1`,
      [input.tenantId, leadRow.organization_id, input.captureLeadId, profile.scoring_profile_id, fingerprint],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('LEAD_SCORING_IDEMPOTENCY_CONFLICT');
    scoreId = row.score_id;
    if (Number(row.total_score) !== calculated.totalScore || row.band !== calculated.band) {
      throw new Error('LEAD_SCORING_REPLAY_CONFLICT');
    }
  } else {
    for (const component of calculated.components) {
      await client.query(
        `INSERT INTO platform.lead_score_components (
           tenant_id, organization_id, score_id, component_key, raw_value,
           weight, points_awarded, points_possible, explanation
         ) VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb,$6,$7,$8,$9)`,
        [
          input.tenantId,
          leadRow.organization_id,
          scoreId,
          component.componentKey,
          JSON.stringify(component.rawValue),
          component.weight,
          component.pointsAwarded,
          component.pointsPossible,
          component.explanation,
        ],
      );
    }
  }

  return {
    scoreId,
    captureLeadId: input.captureLeadId,
    scoringProfileId: profile.scoring_profile_id,
    profileKey: profile.profile_key,
    profileVersion: profile.version,
    totalScore: calculated.totalScore,
    band: calculated.band,
    calculationFingerprint: fingerprint,
    replayed,
  };
}
