/**
 * robots.txt per RFC 9309, plus the non-standard Crawl-delay that several of our sources use.
 *
 * Group selection: the group whose user-agent token appears in our product token wins, else `*`.
 * Rule selection: the longest matching path pattern wins; on a tie, Allow wins.
 * Patterns support `*` (any run of characters) and a trailing `$` (end of path).
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
  crawlDelaySeconds: number | null;
}

interface Group {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
}

export function parseRobots(text: string, productToken: string): RobotsPolicy {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow means "allow everything" and adds no rule.
      if (value) current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }

  const token = productToken.toLowerCase();
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return {
    rules: chosen.flatMap((g) => g.rules),
    crawlDelaySeconds: chosen.reduce<number | null>(
      (max, g) => (g.crawlDelay === null ? max : Math.max(max ?? 0, g.crawlDelay)),
      null,
    ),
  };
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** `pathAndQuery` is the URL path plus query string, e.g. "/products.json?page=2". */
export function isAllowed(policy: RobotsPolicy, pathAndQuery: string): boolean {
  let best: RobotsRule | null = null;
  for (const rule of policy.rules) {
    if (!patternToRegExp(rule.pattern).test(pathAndQuery)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
