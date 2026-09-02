import assert from "node:assert/strict";
import test from "node:test";
import type { AiGateway, AiProposal } from "@expadio/ai-gateway";
import {
  extractDentexClinicalConsultation,
  validateToothNumber,
  STANDARD_CDT_PROCEDURES,
} from "../src/index.ts";

test("validateToothNumber validates universal 1-32 numbering and primary letters", () => {
  assert.equal(validateToothNumber("1"), true);
  assert.equal(validateToothNumber("19"), true);
  assert.equal(validateToothNumber("32"), true);
  assert.equal(validateToothNumber("33"), false);
  assert.equal(validateToothNumber("A"), true);
  assert.equal(validateToothNumber("T"), true);
  assert.equal(validateToothNumber("Z"), false);
});

test("STANDARD_CDT_PROCEDURES contains standard categories", () => {
  assert.equal(STANDARD_CDT_PROCEDURES.D0150.category, "DIAGNOSTIC");
  assert.equal(STANDARD_CDT_PROCEDURES.D2740.category, "RESTORATIVE");
  assert.equal(STANDARD_CDT_PROCEDURES.D3330.category, "ENDODONTICS");
});

test("extractDentexClinicalConsultation extracts tooth, CDT procedure, and urgency from crown notes", async () => {
  const mockProposal: AiProposal = {
    invocationId: "inv_crown_1",
    tenantId: "tenant_dentex_01",
    status: "PROPOSAL",
    outputReference: "ref://ai-output/crown_extraction",
    confidence: 0.96,
    provenance: {
      connectorKey: "connector.ai.gemini.us",
      providerKey: "google-ai",
      modelKey: "gemini-2.0-flash",
      promptConfigurationKey: "prompt.dentex.clinical_extraction",
      promptConfigurationVersion: 1,
      sourceReferences: ["notes"],
      processedAt: new Date().toISOString(),
      costMinorUnits: 1,
    },
  };

  const mockAiGateway: AiGateway = {
    invoke: async () => mockProposal,
  };

  const result = await extractDentexClinicalConsultation({
    tenantId: "tenant_dentex_01",
    patientId: "pat_001",
    practiceId: "prac_001",
    consultationNotes: "Patient presented with fractured mesial-lingual cusp on tooth #19. Recommend ceramic crown D2740.",
    aiGateway: mockAiGateway,
    idempotencyKey: "idem_consult_01",
  });

  assert.equal(result.proposedTreatmentAttributes.tooth, "19");
  assert.equal(result.proposedTreatmentAttributes.procedureCode, "D2740");
  assert.equal(result.proposedTreatmentAttributes.urgency, "Priority");
  assert.equal(result.extractedFindings.length, 1);
  assert.equal(result.extractedFindings[0].tooth, "19");
  assert.equal(result.extractedFindings[0].severity, "MODERATE");
});

test("extractDentexClinicalConsultation flags emergency urgency for root canal / severe abscess", async () => {
  const mockProposal: AiProposal = {
    invocationId: "inv_endo_1",
    tenantId: "tenant_dentex_01",
    status: "PROPOSAL",
    outputReference: "ref://ai-output/endo_extraction",
    confidence: 0.98,
    provenance: {
      connectorKey: "connector.ai.gemini.us",
      providerKey: "google-ai",
      modelKey: "gemini-2.0-flash",
      promptConfigurationKey: "prompt.dentex.clinical_extraction",
      promptConfigurationVersion: 1,
      sourceReferences: ["notes"],
      processedAt: new Date().toISOString(),
      costMinorUnits: 1,
    },
  };

  const mockAiGateway: AiGateway = {
    invoke: async () => mockProposal,
  };

  const result = await extractDentexClinicalConsultation({
    tenantId: "tenant_dentex_01",
    patientId: "pat_002",
    practiceId: "prac_001",
    consultationNotes: "Severe pain on tooth #14 with acute apical abscess. Immediate root canal D3330 required.",
    aiGateway: mockAiGateway,
    idempotencyKey: "idem_consult_02",
  });

  assert.equal(result.proposedTreatmentAttributes.tooth, "14");
  assert.equal(result.proposedTreatmentAttributes.procedureCode, "D3330");
  assert.equal(result.proposedTreatmentAttributes.urgency, "Emergency");
  assert.equal(result.extractedFindings[0].severity, "SEVERE");
});
