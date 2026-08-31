BEGIN;

INSERT INTO platform.capabilities (
  capability_key,
  display_name,
  permitted_modes,
  enabled
)
VALUES
  ('ai.generate', 'AI Generate', ARRAY['A']::text[], true),
  ('ai.classify', 'AI Classify', ARRAY['A']::text[], true),
  ('ai.summarize', 'AI Summarize', ARRAY['A']::text[], true),
  ('ai.extract', 'AI Extract', ARRAY['A']::text[], true),
  ('ai.embed', 'AI Embed', ARRAY['A']::text[], true),
  ('ai.rerank', 'AI Rerank', ARRAY['A']::text[], true),
  ('ai.vision_analyze', 'AI Vision Analyze', ARRAY['A']::text[], true),
  ('ai.translate', 'AI Translate', ARRAY['A']::text[], true),
  ('voice.transcribe', 'Voice Transcribe', ARRAY['A']::text[], true),
  ('voice.synthesize', 'Voice Synthesize', ARRAY['A']::text[], true),
  ('voice.stream_conversation', 'Voice Stream Conversation', ARRAY['A']::text[], true),
  ('storage.store', 'Object Storage Store', ARRAY['A']::text[], true),
  ('storage.read', 'Object Storage Read', ARRAY['A']::text[], true)
ON CONFLICT (capability_key) DO NOTHING;

COMMIT;
