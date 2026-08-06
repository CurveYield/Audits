"use strict";

const fs = require("fs");
const path = require("path");
const { serializable } = require("./executor-v18");

function allRecords(ledger) {
  return ledger.inventory.flatMap(item => ledger.resultsFor(item.id).map(record => ({
    id: item.id,
    ...record
  })));
}

function buildSimulationReport({ metadata, ledger, cycles, setup = null }) {
  const coverage = ledger.summary();
  const records = allRecords(ledger);
  const reverts = records.filter(record => record.error);
  const failures = ledger.failures();
  const cycleNames = ["openingCycle", "closingCycle"];
  const cyclesComplete = cycleNames.every(name =>
    cycles
    && cycles[name]
    && cycles[name].elapsedSeconds === 15 * 24 * 60 * 60
    && Object.keys(cycles[name].components || {}).length > 0
  );
  return serializable({
    schema: "curveyield-function-simulation-v18",
    generatedAt: new Date().toISOString(),
    metadata,
    overallStatus: coverage.missingCount === 0
      && coverage.failureCount === 0
      && cyclesComplete
      ? "passed"
      : "failed",
    coverage,
    setup,
    cycles,
    failures,
    reverts,
    functions: ledger.toJSON()
  });
}

function metric(component, key) {
  const value = component && component.metrics && component.metrics[key];
  return value === undefined || value === null ? "—" : String(value);
}

function assetAmounts(values) {
  const entries = Object.entries(values || {});
  return entries.length === 0
    ? "—"
    : entries.map(([asset, value]) => `${asset}: ${value}`).join("; ");
}

function cycleMarkdown(title, cycle) {
  const lines = [`## ${title}`, ""];
  if (!cycle) return [...lines, "Cycle did not run.", ""];
  lines.push(
    `Elapsed: ${cycle.elapsedSeconds} seconds`,
    "",
    "| Contract | Principal asset | Deposited | Withdrawal proceeds | Principal delta | Claimed rewards | Net yield by asset | PPS before → after |",
    "|---|---|---:|---:|---:|---|---|---|"
  );
  for (const [name, component] of Object.entries(cycle.components || {})) {
    const ppsValues = component.metrics && component.metrics.pps || {};
    lines.push(
      `| ${name} | ${metric(component, "principalAsset")} | `
      + `${metric(component, "depositedPrincipal")} | ${metric(component, "withdrawalProceeds")} | `
      + `${metric(component, "principalDelta")} | `
      + `${assetAmounts(component.metrics && component.metrics.claimedRewardsByAsset)} | `
      + `${assetAmounts(component.metrics && component.metrics.netYieldByAsset)} | `
      + `${ppsValues.beforeDeposit || "—"} → ${ppsValues.afterWithdrawal || "—"} |`
    );
  }
  lines.push("");
  return lines;
}

function renderSimulationMarkdown(report) {
  const lines = [
    "# CurveYield V18.9 ABI Function Fork Simulation",
    "",
    `Overall status: **${String(report.overallStatus).toUpperCase()}**`,
    "",
    `ABI Coverage: ${report.coverage.classifiedCount} / ${report.coverage.inventoryCount}`,
    "",
    `Fork block: ${report.metadata && report.metadata.forkBlock !== undefined ? report.metadata.forkBlock : "—"}`,
    "",
    ...cycleMarkdown("Opening 15-Day Cycle", report.cycles && report.cycles.openingCycle),
    ...cycleMarkdown("Closing 15-Day Cycle", report.cycles && report.cycles.closingCycle),
    "## Reverts",
    ""
  ];
  if (!report.reverts || report.reverts.length === 0) {
    lines.push("No reverts recorded.", "");
  } else {
    lines.push("| Contract | Signature | Status | Decoded error |", "|---|---|---|---|");
    for (const record of report.reverts) {
      const decoded = record.error && (record.error.decoded || record.error.message) || "unknown";
      lines.push(`| ${record.contractKey} | \`${record.signature}\` | ${record.status} | \`${decoded}\` |`);
    }
    lines.push("");
  }
  lines.push("## Failures", "");
  if (!report.failures || report.failures.length === 0) {
    lines.push("No failed or blocked scenarios.", "");
  } else {
    for (const failure of report.failures) {
      lines.push(`- ${failure.contractKey} \`${failure.signature}\`: ${failure.status}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function writeSimulationReports({ outputDir, tag, report }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `function-simulation-${tag}.json`);
  const markdownPath = path.join(outputDir, `function-simulation-${tag}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderSimulationMarkdown(report));
  return { jsonPath, markdownPath };
}

module.exports = {
  buildSimulationReport,
  renderSimulationMarkdown,
  writeSimulationReports
};
