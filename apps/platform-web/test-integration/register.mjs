import { register } from 'node:module';

// Register the extensionless-.ts resolution hook for the integration harness.
register('./resolve-hook.mjs', import.meta.url);
