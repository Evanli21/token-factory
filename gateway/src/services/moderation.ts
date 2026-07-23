import { prisma } from '@szrouter/database';

export async function moderate(content: string, userId: string, requestId: string) {
  const rules = await prisma.moderationRule.findMany({ where: { enabled: true }, orderBy: { priority: 'asc' } });
  for (const rule of rules) {
    let matched = false;
    try {
      matched = rule.type === 'REGEX'
        ? new RegExp(rule.pattern, 'iu').test(content)
        : content.toLocaleLowerCase().includes(rule.pattern.toLocaleLowerCase());
    } catch {
      matched = false;
    }
    if (!matched) continue;
    await prisma.moderationLog.create({ data: { ruleId: rule.id, userId, requestId, content: content.slice(0, 4000), action: rule.action } });
    if (rule.action === 'BLOCK') return { allowed: false, rule: rule.name };
  }
  return { allowed: true };
}
