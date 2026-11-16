import { appendFileSync } from "node:fs";

import { gitRepository, planChanges } from "./change-plan.mjs";
import { CI_FLAGS as flags } from "./scopes.mjs";

const plan = planChanges(
  {
    event: process.env.GITHUB_EVENT_NAME,
    full: process.env.CI_FULL === "true",
    skipFull: process.env.CI_SKIP_FULL === "true",
    base: process.env.BASE_SHA,
    head: process.env.HEAD_SHA,
    baselineReason: process.env.BASELINE_REASON,
  },
  gitRepository(),
);
const { tier, matrix, reasons, testSelection, testShards } = plan;
const selected = Object.fromEntries(flags.map((flag) => [flag, plan[flag]]));

// fork 变更：fork runner 缺上游的 macOS 产物环境，Apple E2E 必挂。在分类层关闭
// apple lane——required.mjs 拒绝「选中 lane 的 skipped」，故在输出前关闭。
// 用显式开关（CI_FORK_APPLE_OFF，仅由 ci.yml 的 changes 步骤在 fork 上注入 1）
// 而不是 GITHUB_REPOSITORY：单测以 ...process.env 运行相关脚本，真实 CI 的该
// 变量会泄漏进测试进程。上游不受影响。同步上游时删除本块与 required.mjs 同款。
if (process.env.CI_FORK_APPLE_OFF === "1" && "apple" in selected) {
  selected.apple = false;
  plan.apple = false;
}
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries({
      ...selected,
      tier,
      matrix: JSON.stringify(matrix),
      test_selection: JSON.stringify(testSelection),
      test_mode: testSelection.mode,
      test_shards: JSON.stringify(testShards),
    })
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Selected CI lanes (${tier})\n\n${flags.filter((flag) => selected[flag]).join(", ") || "Formatting only"}\n\n${reasons.join("\n\n")}\n\nPortable tests (${testSelection.mode}): ${testSelection.reason}\n`,
  );
console.log(JSON.stringify(plan));
