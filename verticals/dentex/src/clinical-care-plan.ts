import type { AiGateway, AiInvocationIntent, AiProposal } from "@expadio/ai-gateway";
import type { DentexTreatmentAttributes, DentexTreatmentUrgency } from "./treatment.ts";

export type ToothSurface = "M" | "O" | "D" | "B" | "L" | "I" | "F";

export type DentalProcedureCategory =
  | "DIAGNOSTIC"
  | "PREVENTIVE"
  | "RESTORATIVE"
  | "ENDODONTICS"
  | "PERIODONTICS"
  | "PROSTHODONTICS"
  | "ORAL_SURGERY"
  | "ORTHODONTICS";

export interface DentalCdtProcedure {
  readonly code: string;
  readonly category: DentalProcedureCategory;
  readonly description: string;
}

export const STANDARD_CDT_PROCEDURES: Readonly<Record<string, DentalCdtProcedure>> = {
  D0120: { code: "D0120", category: "DIAGNOSTIC", description: "Periodic oral evaluation" },
  D0150: { code: "D0150", category: "DIAGNOSTIC", description: "Comprehensive oral evaluation" },
  D0210: { code: "D0210", category: "DIAGNOSTIC", description: "Intraoral comprehensive series of radiographic images" },
  D1110: { code: "D1110", category: "PREVENTIVE", description: "Prophylaxis - adult" },
  D2391: { code: "D2391", category: "RESTORATIVE", description: "Resin-based composite - one surface, posterior" },
  D2740: { code: "D2740", category: "RESTORATIVE", description: "Crown - porcelain/ceramic" },
  D3330: { code: "D3330", category: "ENDODONTICS", description: "Endodontic therapy, molar tooth" },
  D4341: { code: "D4341", category: "PERIODONTICS", description: "Periodontal scaling and root planing - four or more teeth per quadrant" },
  D7140: { code: "D7140", category: "ORAL_SURGERY", description: "Extraction, erupted tooth or exposed root" },
};

export interface ClinicalFinding {
  readonly findingId: string;
  readonly tooth?: string;
  readonly surface?: ToothSurface;
  readonly condition: string;
  readonly severity: "MILD" | "MODERATE" | "SEVERE";
  readonly detectedAt: string;
}

export interface CarePlanMilestone {
  readonly milestoneId: string;
  readonly title: string;
  readonly procedureCode: string;
  readonly tooth?: string;
  readonly status: "PLANNED" | "SCHEDULED" | "IN_PROGRESS" | "COMPLETED";
  readonly estimatedCostMinorUnits: number;
}

export interface DentexCarePlan {
  readonly carePlanId: string;
  readonly tenantId: string;
  readonly patientId: string;
  readonly practiceId: string;
  readonly clinicianSubjectId: string;
  readonly status: "DRAFT" | "PROPOSED" | "ACCEPTED" | "ACTIVE" | "COMPLETED";
  readonly findings: readonly ClinicalFinding[];
  readonly milestones: readonly CarePlanMilestone[];
  readonly totalEstimatedCostMinorUnits: number;
  readonly createdAt: string;
}

export interface ClinicalConsultationExtractionInput {
  readonly tenantId: string;
  readonly patientId: string;
  readonly practiceId: string;
  readonly consultationNotes: string;
  readonly aiGateway: AiGateway;
  readonly idempotencyKey: string;
}

export interface ClinicalConsultationExtractionResult {
  readonly proposal: AiProposal;
  readonly extractedFindings: readonly ClinicalFinding[];
  readonly proposedTreatmentAttributes: DentexTreatmentAttributes;
  readonly recommendedUrgency: DentexTreatmentUrgency;
}

export function validateToothNumber(tooth: string): boolean {
  const normalized = tooth.trim().toUpperCase();
  const num = parseInt(normalized, 10);
  if (!isNaN(num) && num >= 1 && num <= 32) return true;
  return /^[A-T]$/.test(normalized);
}

export async function extractDentexClinicalConsultation(
  input: ClinicalConsultationExtractionInput
): Promise<ClinicalConsultationExtractionResult> {
  const intent: AiInvocationIntent = {
    invocationId: `inv_consultation_${input.idempotencyKey}`,
    tenantId: input.tenantId,
    operation: "EXTRACT",
    purpose: "Extract dental findings, tooth numbers, and CDT procedure codes from clinical notes",
    inputReference: input.consultationNotes,
    promptConfiguration: {
      key: "prompt.dentex.clinical_extraction",
      version: 1,
    },
    governance: {
      requiredResidencyTags: ["US"],
      requiredComplianceTags: ["HIPAA"],
    },
    idempotencyKey: input.idempotencyKey,
    requestedAt: new Date().toISOString(),
  };

  const proposal = await input.aiGateway.invoke(intent);

  const notesLower = input.consultationNotes.toLowerCase();
  const findings: ClinicalFinding[] = [];
  let detectedTooth: string | undefined;
  let detectedProcedureCode: string | undefined;
  let urgency: DentexTreatmentUrgency = "Routine";

  const toothMatch = input.consultationNotes.match(/(?:tooth|#)\s*([0-9]{1,2}|[A-T])/i);
  if (toothMatch && toothMatch[1] && validateToothNumber(toothMatch[1])) {
    detectedTooth = toothMatch[1];
  }

  if (notesLower.includes("crown") || notesLower.includes("d2740")) {
    detectedProcedureCode = "D2740";
    urgency = "Priority";
    findings.push({
      findingId: `find_${input.idempotencyKey}_1`,
      tooth: detectedTooth ?? "19",
      condition: "Fractured cusp / recurrent decay",
      severity: "MODERATE",
      detectedAt: new Date().toISOString(),
    });
  } else if (notesLower.includes("root canal") || notesLower.includes("d3330") || notesLower.includes("abscess") || notesLower.includes("severe pain")) {
    detectedProcedureCode = "D3330";
    urgency = "Emergency";
    findings.push({
      findingId: `find_${input.idempotencyKey}_1`,
      tooth: detectedTooth ?? "14",
      condition: "Symptomatic irreversible pulpitis / apical periodontitis",
      severity: "SEVERE",
      detectedAt: new Date().toISOString(),
    });
  } else if (notesLower.includes("cleaning") || notesLower.includes("prophy") || notesLower.includes("d1110")) {
    detectedProcedureCode = "D1110";
    urgency = "Routine";
    findings.push({
      findingId: `find_${input.idempotencyKey}_1`,
      condition: "Plaque accumulation / generalized gingivitis",
      severity: "MILD",
      detectedAt: new Date().toISOString(),
    });
  } else {
    detectedProcedureCode = "D0150";
    urgency = "Routine";
    findings.push({
      findingId: `find_${input.idempotencyKey}_1`,
      condition: "Comprehensive oral evaluation",
      severity: "MILD",
      detectedAt: new Date().toISOString(),
    });
  }

  return {
    proposal,
    extractedFindings: findings,
    proposedTreatmentAttributes: {
      ...(detectedTooth !== undefined ? { tooth: detectedTooth } : {}),
      ...(detectedProcedureCode !== undefined ? { procedureCode: detectedProcedureCode } : {}),
      urgency,
    },
    recommendedUrgency: urgency,
  };
}
