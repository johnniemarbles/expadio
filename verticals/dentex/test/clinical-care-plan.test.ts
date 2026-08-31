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
  assert.equal(validateToothNumber("19abc"), false);
  assert.equal(validateToothNumber("019"), false);
});

test("STANDARD_CDT_PROCEDURES contains standard categories", () => {
  assert.equal(STANDARD_CDT_PROCEDURES.D0150.category, "DIAGNOSTIC");
  assert.equal(STANDARD_CDT_PROCEDURES.D2740.category, "RESTORATIVE");
  assert.equal(STANDARD_CDT_PROCEDURES.D3330.category, "ENDODONTICS");
});

test("extractDentexClinicalConsultation surfaces only explicitly stated tooth and CDT code", async () => {
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
  assert.equal(result.proposedTreatmentAttributes.urgency, undefined);
  assert.equal(result.recommendedUrgency, null);
  assert.equal(result.extractedFindings.length, 0);
});

test("extractDentexClinicalConsultation never invents clinical facts when identifiers are absent", async () => {
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
    consultationNotes: "Patient reports severe pain and may need a root canal. Tooth and diagnosis not yet confirmed.",
    aiGateway: mockAiGateway,
    idempotencyKey: "idem_consult_02",
  });

  assert.deepEqual(result.proposedTreatmentAttributes, {});
  assert.equal(result.recommendedUrgency, null);
  assert.deepEqual(result.extractedFindings, []);
});

test("extractDentexClinicalConsultation ignores unsupported or implicit procedure codes", async () => {
  const mockProposal: AiProposal = {
    invocationId: "inv_unknown_code",
    tenantId: "tenant_dentex_01",
    status: "PROPOSAL",
    outputReference: "ref://ai-output/unknown_code",
    confidence: 0.95,
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

  const mockAiGateway: AiGateway = { invoke: async () => mockProposal };

  const result = await extractDentexClinicalConsultation({
    tenantId: "tenant_dentex_01",
    patientId: "pat_003",
    practiceId: "prac_001",
    consultationNotes: "Discussed possible crown on tooth #12; no procedure code selected. Reference D9999 is not in the governed registry.",
    aiGateway: mockAiGateway,
    idempotencyKey: "idem_consult_03",
  });

  assert.equal(result.proposedTreatmentAttributes.tooth, "12");
  assert.equal(result.proposedTreatmentAttributes.procedureCode, undefined);
  assert.equal(result.recommendedUrgency, null);
  assert.deepEqual(result.extractedFindings, []);
});
