export const MCP_TOOL_REGISTRY: Record<string, string> = {
  // GitHub tools
  'github:list_prs': 'github',
  'github:get_pr': 'github',
  'github:create_pr': 'github',
  'github:merge_pr': 'github',
  'github:list_issues': 'github',
  'github:create_issue': 'github',
  'github:get_repo_info': 'github',
  'github:list_commits': 'github',
  'github:comment_on_pr': 'github',

  // Filesystem tools
  'filesystem:read_file': 'filesystem',
  'filesystem:write_file': 'filesystem',
  'filesystem:list_dir': 'filesystem',
  'filesystem:search_files': 'filesystem',

  // Database tools
  'sqlite:query_db': 'sqlite',
  'sqlite:describe_schema': 'sqlite',
  'sqlite:list_tables': 'sqlite',
  'sqlite:sample_table': 'sqlite',

  // Audit tools
  'audit:log_action': 'audit',
  'audit:check_policy': 'audit',
  'audit:generate_report': 'audit',
};

export const ROLE_ALLOWED_TOOLS: Record<string, readonly string[]> = {
  CODE_ENGINEER: [
    'github:list_prs',
    'github:get_pr',
    'github:create_pr',
    'github:merge_pr',
    'github:list_issues',
    'github:create_issue',
    'github:get_repo_info',
    'github:list_commits',
    'github:comment_on_pr',
    'filesystem:read_file',
    'filesystem:write_file',
    'filesystem:list_dir',
    'filesystem:search_files',
    'audit:log_action',
  ],
  OPS_ADMIN: [
    'sqlite:query_db',
    'sqlite:describe_schema',
    'sqlite:list_tables',
    'sqlite:sample_table',
    'filesystem:read_file',
    'filesystem:list_dir',
    'audit:log_action',
  ],
  COMMUNICATIONS: [
    'filesystem:read_file',
    'audit:log_action',
  ],
  AUDITOR: [
    'sqlite:query_db',
    'sqlite:describe_schema',
    'sqlite:list_tables',
    'sqlite:sample_table',
    'filesystem:read_file',
    'filesystem:list_dir',
    'audit:log_action',
    'audit:check_policy',
    'audit:generate_report',
    'github:list_prs',
    'github:list_issues',
  ],
  DATA_ANALYST: [
    'sqlite:query_db',
    'sqlite:describe_schema',
    'sqlite:list_tables',
    'sqlite:sample_table',
    'filesystem:read_file',
    'audit:log_action',
  ],
  PRODUCT_MANAGER: [
    'github:list_prs',
    'github:get_pr',
    'github:list_issues',
    'github:create_issue',
    'filesystem:read_file',
    'audit:log_action',
  ],
  SECURITY: [
    'github:list_prs',
    'github:get_pr',
    'filesystem:read_file',
    'audit:check_policy',
    'audit:log_action',
  ],
};

export function getMcpServerForTool(toolKey: string): string | null {
  return MCP_TOOL_REGISTRY[toolKey] ?? null;
}

export function getAllowedToolsForRole(role: string): readonly string[] {
  const tools = ROLE_ALLOWED_TOOLS[role];
  if (tools !== undefined) return tools;
  return ROLE_ALLOWED_TOOLS.OPS_ADMIN ?? [];
}
