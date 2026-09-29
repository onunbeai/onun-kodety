export const DEFAULT_AGENT_SKILL_NAMES = ['kodety-editor'];

const LEGACY_DEFAULT_SKILLS = new Set([
  'kodety-editor',
  'kodety-widgets',
  'figma',
  'figma-design-to-code',
  'figma:figma-design-to-code',
  'figma-use',
  'figma:figma-use',
]);

export function restoreAgentSkillSelection(stored: string, legacy = false): string[] {
  try {
    const value: unknown = JSON.parse(stored);
    const names = Array.isArray(value)
      ? [...new Set(value.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())).map(name => name.trim()))]
      : [];
    // Only migrate the old automatic combination; retain customized selections.
    const oldDefaults = legacy
      && names.includes('kodety-editor')
      && names.includes('kodety-widgets')
      && names.every(name => LEGACY_DEFAULT_SKILLS.has(name));
    return names.length && !oldDefaults ? names : [...DEFAULT_AGENT_SKILL_NAMES];
  } catch {
    return [...DEFAULT_AGENT_SKILL_NAMES];
  }
}

export function isFigmaDesignToCodeSkill(name: string): boolean {
  return /(?:^|:)figma-design-to-code$/i.test(name) || name.toLowerCase() === 'figma';
}

export function agentSkillDisplayName(name: string, displayName?: string | null): string {
  return isFigmaDesignToCodeSkill(name) ? 'Figma to Kodety' : displayName || name;
}

export function parseFigmaDesignLink(value: string): { url: string; nodeId: string } | null {
  const input = value.trim();
  if (!input) return null;
  try {
    const url = new URL(/^(?:www\.)?figma\.com\//i.test(input) ? `https://${input}` : input);
    if (
      url.protocol !== 'https:'
      || !['figma.com', 'www.figma.com'].includes(url.hostname.toLowerCase())
      || url.username || url.password || url.port
      || !/^\/(?:design|file|proto)\/[a-z0-9_-]+(?:\/|$)/i.test(url.pathname)
    ) return null;
    return { url: url.toString(), nodeId: (url.searchParams.get('node-id') || '').replace(/-/g, ':') };
  } catch {
    return null;
  }
}

export const FIGMA_DESIGN_LINK_ERROR = 'Cole um link de arquivo ou elemento do Figma.';

export function buildAgentComposerPrompt({
  text,
  figmaDesignToCode = false,
  figmaLink = '',
  referenceImages = [],
}: {
  text: string;
  figmaDesignToCode?: boolean;
  figmaLink?: string;
  referenceImages?: string[];
}): string {
  const instructions = text.trim();
  if (!figmaDesignToCode || (!figmaLink.trim() && !referenceImages.length)) return instructions;
  const link = parseFigmaDesignLink(figmaLink);
  if (figmaLink.trim() && !link) throw new Error(FIGMA_DESIGN_LINK_ERROR);
  const sections = ['Implemente o elemento de referência no projeto aberto do Kodety.'];
  if (link) sections.push(`Link do Figma:\n${link.url}`);
  if (referenceImages.length) {
    sections.push(`Prints do elemento anexados como referência visual:\n${referenceImages.map(name => `- ${name.replace(/\s+/g, ' ').trim()}`).join('\n')}`);
  }
  if (instructions) sections.push(`Instruções complementares:\n${instructions}`);
  return sections.join('\n\n');
}
