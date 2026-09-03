export interface PersonaSeedDescriptor {
  readonly role: string;
  readonly name: string;
  readonly category: string;
  readonly model: string;
  readonly personaFile: string;
  readonly writePermissions: boolean;
  readonly allowedTools: readonly string[];
}

export function buildPersonaDescriptor(
  filename: string,
  category: string,
  relativePath: string,
): PersonaSeedDescriptor {
  const roleName = filename.toUpperCase().replace(/-/g, '_');
  const name = filename
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

  let model = 'gemini-2.5-pro';
  if (['engineering', 'design', 'security'].includes(category)) {
    model = 'claude-sonnet-4-5';
  } else if (['marketing', 'communications', 'sales'].includes(category)) {
    model = 'gpt-4o';
  }

  const writePermissions = ['engineering', 'design', 'paid-media', 'ops'].includes(category);

  return {
    role: roleName,
    name,
    category,
    model,
    personaFile: relativePath,
    writePermissions,
    allowedTools: [],
  };
}
