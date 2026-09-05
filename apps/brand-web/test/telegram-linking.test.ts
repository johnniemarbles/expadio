import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const settingsClient = readFileSync(
  new URL('../app/(workspace)/settings/brand/BrandSettingsClient.tsx', import.meta.url),
  'utf8',
);
const telegramRoute = readFileSync(
  new URL('../app/api/telegram/link/route.ts', import.meta.url),
  'utf8',
);

test('BrandSettingsClient UI includes Telegram User ID input, status badge, and handlers', () => {
  assert.match(settingsClient, /Telegram User ID/);
  assert.match(settingsClient, /fetch\('\/api\/telegram\/link'/);
  assert.match(settingsClient, /method:\s*'POST'/);
  assert.match(settingsClient, /method:\s*'DELETE'/);
  assert.match(settingsClient, /@userinfobot/);
  assert.match(settingsClient, /LINKED \(ID:/);
});

test('Brand-web Telegram link API route exports GET, POST, DELETE', () => {
  assert.match(telegramRoute, /export async function GET/);
  assert.match(telegramRoute, /export async function POST/);
  assert.match(telegramRoute, /export async function DELETE/);
  assert.match(telegramRoute, /getTelegramUserLink/);
  assert.match(telegramRoute, /linkTelegramUser/);
  assert.match(telegramRoute, /unlinkTelegramUser/);
});
