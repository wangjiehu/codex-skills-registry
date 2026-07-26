import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { escapeHtml } from "./utils.js";
/**
 * Writes a static documentation site for GitHub Pages or generic artifact hosting.
 *
 * @param options - Site output directory and source report data.
 * @returns Written file manifest.
 */
export async function writeRegistrySite(options) {
    const outDir = path.resolve(options.outDir);
    await mkdir(outDir, { recursive: true });
    const files = [
        {
            name: "index.html",
            content: formatSitePage({
                title: "Codex Skills Registry",
                active: "overview",
                body: formatOverview(options),
            }),
        },
        {
            name: "rules.html",
            content: formatSitePage({
                title: "Rules",
                active: "rules",
                body: formatRules(options.rules),
            }),
        },
        {
            name: "policy.html",
            content: formatSitePage({
                title: "Policy",
                active: "policy",
                body: formatPolicy(),
            }),
        },
    ];
    for (const file of files) {
        await writeFile(path.join(outDir, file.name), file.content, "utf8");
    }
    return {
        outDir,
        files: files.map((file) => path.join(outDir, file.name)),
    };
}
function formatOverview(input) {
    const report = input.report;
    return `
<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow">Maintainer automation registry</p>
    <h1>Codex Skills Registry</h1>
    <p>Validate Codex Skills, plugin manifests, MCP server configuration, and GitHub Actions workflow risk before maintainers trust automation in CI.</p>
  </div>
  <div class="status-strip" aria-label="Registry health">
    <span><strong>${report.summary.errors}</strong> errors</span>
    <span><strong>${report.summary.warnings}</strong> warnings</span>
    <span><strong>${report.summary.skills + report.summary.mcpServers + report.summary.plugins}</strong> automation entries</span>
  </div>
</section>
<section aria-labelledby="summary-heading">
  <div class="section-heading">
    <h2 id="summary-heading">Current Registry Snapshot</h2>
    <p>Compact coverage counts from the current repository scan.</p>
  </div>
  <div class="metric-grid">
    ${metric("Skills", report.summary.skills)}
    ${metric("MCP Servers", report.summary.mcpServers)}
    ${metric("Plugins", report.summary.plugins)}
    ${metric("Workflows", report.summary.workflows)}
    ${metric("Errors", report.summary.errors, "danger")}
    ${metric("Warnings", report.summary.warnings, "warn")}
  </div>
</section>
<section aria-labelledby="coverage-heading">
  <div class="section-heading">
    <h2 id="coverage-heading">Coverage</h2>
    <p>Discovered skills, servers, plugins, and workflows.</p>
  </div>
  <div class="split">
    ${listSection("Skills", report.skills.map((skill) => ({
        name: skill.name,
        detail: skill.description,
    })), "No skills discovered.")}
    ${listSection("MCP Servers", report.mcpServers.map((server) => ({
        name: `${server.name} (${server.transport})`,
        detail: server.sourcePath,
    })), "No MCP servers discovered.")}
    ${listSection("Plugins", report.plugins.map((plugin) => ({
        name: plugin.name,
        detail: plugin.sourcePath,
    })), "No plugin manifests discovered.")}
    ${listSection("Workflows", report.workflows.map((workflow) => ({
        name: workflow.name,
        detail: workflow.sourcePath,
    })), "No workflows discovered.")}
  </div>
</section>
<section aria-labelledby="findings-heading">
  <div class="section-heading">
    <h2 id="findings-heading">Findings</h2>
  </div>
  ${formatFindings(report)}
</section>
<section aria-labelledby="next-heading">
  <div class="section-heading">
    <h2 id="next-heading">Next Actions</h2>
  </div>
  ${formatList(report.nextActions, "No immediate action required.")}
</section>
<p class="timestamp">Generated ${escapeHtml(input.generatedAt ?? new Date().toISOString())}</p>`;
}
function formatRules(rules) {
    const categories = [...new Set(rules.map((rule) => ruleCategory(rule.code)))].sort();
    return `
<section class="hero compact">
  <p class="eyebrow">Rules catalog</p>
  <h1>Registry Rules</h1>
  <p>Stable issue codes, what they mean, and how maintainers should resolve them.</p>
</section>
<section class="rule-tools" aria-labelledby="rules-filter-heading">
  <h2 id="rules-filter-heading">Find Rules</h2>
  <div class="filters">
    <label for="rules-search">Search</label>
    <input id="rules-search" type="search" autocomplete="off" placeholder="Issue code, title, or fix">
    <label for="rules-category">Category</label>
    <select id="rules-category">
      <option value="">All categories</option>
      ${categories
        .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
        .join("")}
    </select>
  </div>
  <p class="rule-count"><span id="rules-visible-count">${rules.length}</span> of ${rules.length} rules</p>
</section>
<section class="rules" id="rules-list">
  ${rules
        .map((rule) => `
    <article class="rule" id="${escapeAttribute(rule.code)}" data-rule-card data-category="${escapeHtml(ruleCategory(rule.code))}" data-rule-text="${escapeHtml(ruleSearchText(rule))}">
      <h2><code>${escapeHtml(rule.code)}</code> ${escapeHtml(rule.title)}</h2>
      <p>${escapeHtml(rule.description)}</p>
      <p><strong>Fix:</strong> ${escapeHtml(rule.remediation)}</p>
    </article>`)
        .join("")}
</section>
<p class="empty-state" id="rules-empty" hidden>No matching rules.</p>
<script>
(() => {
  const search = document.getElementById("rules-search");
  const category = document.getElementById("rules-category");
  const count = document.getElementById("rules-visible-count");
  const empty = document.getElementById("rules-empty");
  const cards = Array.from(document.querySelectorAll("[data-rule-card]"));
  const update = () => {
    const query = search.value.trim().toLowerCase();
    const selectedCategory = category.value;
    let visible = 0;
    for (const card of cards) {
      const matchesQuery = !query || card.dataset.ruleText.includes(query);
      const matchesCategory = !selectedCategory || card.dataset.category === selectedCategory;
      const show = matchesQuery && matchesCategory;
      card.hidden = !show;
      if (show) {
        visible += 1;
      }
    }
    count.textContent = String(visible);
    empty.hidden = visible !== 0;
  };
  search.addEventListener("input", update);
  category.addEventListener("change", update);
  update();
})();
</script>`;
}
function formatPolicy() {
    return `
<section class="hero compact">
  <p class="eyebrow">Governance</p>
  <h1>Policy Model</h1>
  <p>Policy files turn advisory checks into repository-specific gates without changing the default onboarding path.</p>
</section>
<section>
  <h2>Recommended starting point</h2>
  <pre><code>extends:
  - recommended
requirePinnedWorkflowActions: false
failOnWarnings: false
suppressions:
  - code: MCP_SHELL_COMMAND
    reason: "Reviewed local-only fixture"
    expiresOn: "2099-01-01"</code></pre>
</section>
<section>
  <h2>Supply-chain strict mode</h2>
  <pre><code>extends:
  - strict-supply-chain</code></pre>
</section>`;
}
function formatSitePage(options) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <style>
    :root { color-scheme: light; --ink: #182033; --muted: #647084; --line: #dde3ec; --panel: #f7f8fa; --surface: #ffffff; --brand: #0f766e; --brand-soft: #e6f3f1; --danger: #b42318; --warn: #9a6700; }
    * { box-sizing: border-box; }
    body { background: #f5f6f8; color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; margin: 0; overflow-x: hidden; }
    header { background: rgba(255, 255, 255, 0.94); border-bottom: 1px solid var(--line); }
    nav, main { margin: 0 auto; max-width: 1180px; padding: 0 24px; }
    nav { align-items: center; display: flex; min-height: 58px; gap: 22px; }
    nav a { color: var(--muted); font-size: 15px; font-weight: 650; text-decoration: none; }
    nav a[aria-current="page"] { color: var(--brand); }
    nav a:hover { color: var(--ink); }
    main { padding-bottom: 48px; }
    .brand { color: var(--ink); font-size: 16px; font-weight: 750; margin-right: auto; }
    .hero { align-items: end; border-bottom: 1px solid var(--line); display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr) auto; min-width: 0; padding: 48px 0 32px; }
    .hero.compact { display: block; padding-bottom: 26px; }
    .hero-copy { min-width: 0; }
    .hero-copy p { color: var(--muted); font-size: 18px; margin-bottom: 0; }
    .eyebrow { color: var(--brand); font-size: 12px; font-weight: 760; letter-spacing: 0; margin: 0 0 10px; text-transform: uppercase; }
    h1 { font-size: clamp(34px, 4vw, 48px); line-height: 1.08; letter-spacing: 0; margin: 0 0 14px; max-width: 760px; }
    h2 { font-size: 21px; letter-spacing: 0; margin: 0; }
    h3 { font-size: 17px; margin: 0 0 10px; }
    p { max-width: 760px; overflow-wrap: break-word; }
    .section-heading { align-items: end; border-top: 1px solid var(--line); display: flex; gap: 16px; justify-content: space-between; margin: 34px 0 14px; padding-top: 22px; }
    .section-heading p { color: var(--muted); font-size: 14px; margin: 0; text-align: right; }
    code, pre { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; }
    code { padding: 2px 5px; }
    pre { overflow-x: auto; padding: 16px; }
    pre code { border: 0; padding: 0; }
    .status-strip { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; display: grid; gap: 0; max-width: 100%; min-width: 280px; }
    .status-strip span { align-items: baseline; border-bottom: 1px solid var(--line); color: var(--muted); display: flex; gap: 8px; justify-content: space-between; padding: 10px 12px; white-space: nowrap; }
    .status-strip span:last-child { border-bottom: 0; }
    .status-strip strong { color: var(--ink); font-size: 20px; }
    .metric-grid { display: grid; gap: 10px; grid-template-columns: repeat(6, minmax(0, 1fr)); }
    .metric { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; min-width: 0; padding: 15px 16px; }
    .metric span { color: var(--muted); display: block; font-size: 12px; font-weight: 760; text-transform: uppercase; }
    .metric strong { display: block; font-size: 30px; line-height: 1; margin-top: 10px; }
    .metric.danger strong { color: var(--danger); }
    .metric.warn strong { color: var(--warn); }
    .split { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(235px, 1fr)); }
    .list-block, .rule { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 16px; }
    .rule + .rule { margin-top: 12px; }
    .rule-tools { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; margin: 24px 0; padding: 16px; }
    .rule-tools h2 { margin-top: 0; }
    .filters { align-items: end; display: grid; gap: 10px 12px; grid-template-columns: auto minmax(180px, 1fr) auto minmax(160px, 220px); }
    input, select { border: 1px solid var(--line); border-radius: 6px; color: var(--ink); font: inherit; min-height: 40px; padding: 8px 10px; width: 100%; }
    .rule-count, .empty-state { color: var(--muted); font-size: 14px; margin: 12px 0 0; }
    [hidden] { display: none !important; }
    ul { margin: 8px 0 0; padding-left: 18px; }
    li { margin: 6px 0; overflow-wrap: break-word; }
    .item-list { list-style: none; padding-left: 0; }
    .item-list li { border-top: 1px solid var(--line); margin: 0; padding: 9px 0; }
    .item-list li:first-child { border-top: 0; padding-top: 0; }
    .item-title { display: block; font-weight: 720; }
    .item-detail { color: var(--muted); display: block; font-size: 14px; margin-top: 2px; overflow-wrap: anywhere; }
    .finding.error { color: var(--danger); }
    .finding.warning { color: var(--warn); }
    .timestamp { color: var(--muted); font-size: 13px; margin-top: 40px; }
    @media (max-width: 980px) { .hero { align-items: start; grid-template-columns: 1fr; } .status-strip { min-width: 0; } .metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 640px) { nav, main { max-width: 100vw; width: 100vw; } nav { align-items: flex-start; flex-direction: column; gap: 8px; padding-bottom: 16px; padding-top: 16px; } .brand { margin-right: 0; } h1 { font-size: 30px; max-width: 100%; } .hero-copy p { font-size: 16px; max-width: 100%; } .filters, .metric-grid { grid-template-columns: 1fr; } .section-heading { align-items: start; flex-direction: column; } .section-heading p { max-width: 100%; text-align: left; } .status-strip { width: 100%; } .status-strip span { display: grid; grid-template-columns: 44px minmax(0, 1fr); justify-content: start; white-space: normal; } }
  </style>
</head>
<body>
  <header>
    <nav aria-label="Primary navigation">
      <a class="brand" href="index.html">Codex Skills Registry</a>
      ${navLink("Overview", "index.html", options.active === "overview")}
      ${navLink("Rules", "rules.html", options.active === "rules")}
      ${navLink("Policy", "policy.html", options.active === "policy")}
    </nav>
  </header>
  <main>
    ${options.body}
  </main>
</body>
</html>
`;
}
function metric(label, value, tone) {
    return `<div class="metric${tone ? ` ${tone}` : ""}"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
}
function listSection(title, values, empty) {
    if (values.length === 0) {
        return `<section class="list-block"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(empty)}</p></section>`;
    }
    return `<section class="list-block"><h3>${escapeHtml(title)}</h3><ul class="item-list">${values
        .map((value) => `<li><span class="item-title">${escapeHtml(value.name)}</span><span class="item-detail">${escapeHtml(value.detail)}</span></li>`)
        .join("")}</ul></section>`;
}
function formatFindings(report) {
    if (report.issues.length === 0) {
        return "<p>No active findings.</p>";
    }
    return `<ul>${report.issues
        .map((issue) => `<li class="finding ${issue.severity}"><code>${escapeHtml(issue.code ?? "REGISTRY_ISSUE")}</code> ${escapeHtml(issue.path)}: ${escapeHtml(issue.message)}</li>`)
        .join("")}</ul>`;
}
function formatList(values, empty) {
    if (values.length === 0) {
        return `<p>${escapeHtml(empty)}</p>`;
    }
    return `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}
function navLink(label, href, active) {
    return `<a href="${href}"${active ? ' aria-current="page"' : ""}>${label}</a>`;
}
function escapeAttribute(value) {
    return escapeHtml(value).replace(/[^A-Za-z0-9_-]/g, "-");
}
function ruleCategory(code) {
    return code.split("_")[0] ?? "REGISTRY";
}
function ruleSearchText(rule) {
    return [rule.code, rule.title, rule.description, rule.remediation].join(" ").toLowerCase();
}
//# sourceMappingURL=site.js.map