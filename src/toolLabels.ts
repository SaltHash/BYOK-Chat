/** Display names for tool ids, shared by the chat process log and the Stats
 *  tool breakdown so one tool reads the same in both places. The fallback
 *  covers MCP server tools, whose ids are built from the configured server and
 *  function names. */
export const TOOL_LABELS: Record<string, string> = {
  search: 'Web search',
  fetch_page: 'Page reader',
  time: 'Time',
  date: 'Date',
  calc: 'Calculator',
  count: 'Text count',
  json: 'JSON formatter',
  base64: 'Base64 encoder',
  location: 'Location',
  clipboard: 'Clipboard',
  uuid: 'UUID',
  random: 'Random integer',
  hash: 'SHA-256',
  memory: 'Memory',
  graph: 'Graph',
  run_code: 'Code',
  use_skill: 'Skill',
  prompt_chip: 'Follow-up',
  inline_poll: 'Choice',
  workspace_upsert: 'Workspace files',
  show_artifact: 'Artifact',
  navigate: 'App links',
}

export const toolLabel = (id: string): string =>
  TOOL_LABELS[id] ?? (id.startsWith('mcp_') ? `MCP · ${id.slice(4).replace(/_/g, ' ')}` : id)
