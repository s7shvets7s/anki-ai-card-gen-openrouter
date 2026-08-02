(function initSiteAccess(globalScope) {
  function parseRules(value) {
    const source = Array.isArray(value) ? value.join("\n") : String(value || "");
    return [...new Set(source
      .split(/[\r\n,]+/)
      .map((rule) => rule.trim())
      .filter((rule) => rule && !rule.startsWith("#"))
      .map(normalizeRule)
      .filter(Boolean))];
  }

  function normalizeRule(rule) {
    return String(rule || "")
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }

  function matchesRule(urlValue, ruleValue) {
    let url;
    try {
      url = new URL(urlValue);
    } catch {
      return false;
    }
    if (!/^https?:$/.test(url.protocol)) return false;

    const rule = normalizeRule(ruleValue);
    if (!rule) return false;
    const slashIndex = rule.indexOf("/");
    const hostRule = (slashIndex >= 0 ? rule.slice(0, slashIndex) : rule).replace(/^\*\./, "");
    const pathRule = slashIndex >= 0 ? rule.slice(slashIndex) : "";
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const hostMatches = hostname === hostRule || hostname.endsWith(`.${hostRule}`);
    if (!hostMatches) return false;
    if (!pathRule) return true;

    const candidate = `${url.pathname}${url.search}`.toLowerCase();
    const pattern = pathRule
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${pattern}`).test(candidate);
  }

  function isAllowed(url, mode = "blocklist", rulesValue = "") {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return true;
    }
    if (!/^https?:$/.test(parsed.protocol)) return true;
    const matched = parseRules(rulesValue).some((rule) => matchesRule(parsed.href, rule));
    return mode === "allowlist" ? matched : !matched;
  }

  function getSiteRule(urlValue) {
    try {
      const url = new URL(urlValue);
      if (!/^https?:$/.test(url.protocol)) return "";
      return url.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  globalScope.SiteAccess = Object.freeze({ parseRules, normalizeRule, matchesRule, isAllowed, getSiteRule });
})(globalThis);
