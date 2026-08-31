BEGIN;

-- LMS-04 — versioned programs, learner program assignments, certifications,
-- governed credential issuance, and renewal/expiry lifecycle.

ALTER TABLE platform.learning_programs
  -- placeholder guarded below for migration ordering safety
  NO INHERIT platform.learning_programs;
