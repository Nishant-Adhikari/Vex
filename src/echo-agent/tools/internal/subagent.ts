/**
 * Subagent internal tool handlers — aggregator.
 * Split into modules: subagent-lifecycle, subagent-parent, subagent-child.
 */

export { handleSubagentSpawn, handleSubagentStatus, handleSubagentStop, handleSubagentReply } from "./subagent/parent.js";
export { handleSubagentRequestParent, handleSubagentReportComplete } from "./subagent/child.js";
export { getActiveCount } from "./subagent/lifecycle.js";
