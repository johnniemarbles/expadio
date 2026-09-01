BEGIN;

-- Extend the existing product-module manifest with a serializable shell
-- descriptor. Entitlement and activation remain authoritative; this metadata
-- contributes navigation only and can never grant module access.
UPDATE platform.product_modules
SET manifest = manifest || jsonb_build_object(
  'shell',
  jsonb_build_object(
    'category', 'People',
    'iconKey', 'learning',
    'defaultPinned', true,
    'order', 100,
    'sections', jsonb_build_array(
      jsonb_build_object('id','overview','label','Overview','href','/learning','placement','primary'),
      jsonb_build_object('id','courses','label','Courses','href','/learning/courses','placement','primary'),
      jsonb_build_object('id','people','label','People','href','/learning/learners','placement','primary'),
      jsonb_build_object('id','programs','label','Programs','href','/learning/programs','placement','primary'),
      jsonb_build_object('id','skills','label','Skills','href','/learning/skills','placement','primary'),
      jsonb_build_object('id','reports','label','Reports','href','/learning/reports','placement','primary'),
      jsonb_build_object('id','assessments','label','Assessments','href','/learning/assessments','placement','more'),
      jsonb_build_object('id','assignments','label','Assignments','href','/learning/assignments','placement','more'),
      jsonb_build_object('id','ai','label','AI tutor & author','href','/learning/ai','placement','more'),
      jsonb_build_object('id','settings','label','Settings','href','/learning/settings','placement','more')
    ),
    'quickActions', jsonb_build_array(
      jsonb_build_object('id','create-course','label','Create course','href','/learning/courses'),
      jsonb_build_object('id','manage-learners','label','Manage learners','href','/learning/learners'),
      jsonb_build_object('id','learning-ai','label','Open Learning AI','href','/learning/ai')
    )
  )
),
updated_at = now()
WHERE module_key = 'learning';

COMMIT;
