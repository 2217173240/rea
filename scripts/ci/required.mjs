import { CI_FLAGS, CI_LANES } from "./scopes.mjs";
import { recordQualification } from "./qualification.mjs";

const jobs = JSON.parse(process.env.CI_JOBS);
const outputs = jobs?.changes?.outputs;
if (!["fast", "full", "reused"].includes(outputs?.tier))
  throw new Error(
    "CI classification requires a valid tier: fast, full, or reused",
  );
const invalidFlags = CI_FLAGS.filter(
  (flag) => outputs[flag] !== "true" && outputs[flag] !== "false",
);
if (invalidFlags.length)
  throw new Error(
    `CI classification requires explicit true/false scope outputs: ${invalidFlags.join(", ")}`,
  );
const selectedScopes = CI_FLAGS.filter((flag) => outputs[flag] === "true");
// fork 变更：fork 在分类层关闭 apple lane（缺上游 macOS 产物环境，E2E 必挂），
// full 档的「全 canonical scope」不变量在 fork 上把 apple 移出 canonical 集合。
// 用显式开关（与 plan.mjs 同款，见其注释）避免 GITHUB_REPOSITORY 泄漏进单测。
const canonicalFlags =
  process.env.CI_FORK_APPLE_OFF === "1"
    ? CI_FLAGS.filter((flag) => flag !== "apple")
    : CI_FLAGS;
const reused = outputs.tier === "reused";
if (
  reused &&
  (process.env.GITHUB_EVENT_NAME !== "schedule" ||
    !/^[1-9]\d*$/.test(outputs.qualification_run_id ?? "") ||
    !Number.isSafeInteger(Number(outputs.qualification_run_id)) ||
    selectedScopes.length !== 0)
)
  throw new Error(
    "Reused qualification requires a scheduled admission receipt and no selected lanes",
  );
if (outputs.tier === "full" && selectedScopes.length !== canonicalFlags.length)
  throw new Error("Full qualification requires every canonical CI scope");
// Only a fast pull-request plan may run a selected test subset.
const testMode = outputs.test_mode;
if (
  !["full", "selected"].includes(testMode) ||
  (testMode === "selected" &&
    (outputs.tier !== "fast" ||
      process.env.GITHUB_EVENT_NAME !== "pull_request" ||
      outputs.code !== "true"))
)
  throw new Error(
    "CI classification requires a valid test mode: full, or selected on a fast pull request",
  );
const required = reused ? ["changes"] : ["changes", "static", "test"];
if (outputs.tier === "full") required.push("static-deep");
for (const scope of selectedScopes)
  required.push(
    ...((testMode === "selected" && CI_LANES[scope].selectedTests) ||
      CI_LANES[scope].required[outputs.tier]),
  );
const failed = [...new Set(required)].filter(
  (name) => jobs[name]?.result !== "success",
);
for (const [name, job] of Object.entries(jobs)) {
  if (["failure", "cancelled"].includes(job.result) && !failed.includes(name))
    failed.push(name);
}
if (failed.length)
  throw new Error(`CI lanes did not pass: ${failed.join(", ")}`);
console.log("Every selected CI lane passed");
if (reused)
  console.log(
    `Qualification reused from run ${outputs.qualification_run_id}; no fresh provider observation`,
  );
if (outputs.tier === "full" && process.env.CI_QUALIFICATION_DIRECTORY)
  recordQualification(process.env.CI_QUALIFICATION_DIRECTORY);
