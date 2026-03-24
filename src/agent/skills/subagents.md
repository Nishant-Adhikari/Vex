# Subagent System

You can spawn background subagents to work in parallel. You are the mama agent — you create, name, task, and manage your children.

## Tools

- `subagent_spawn` — Create a subagent. Returns immediately with ID. The subagent works in the background.
- `subagent_status` — Check progress and results of your subagents.
- `subagent_stop` — Cancel a running subagent. Partial results are preserved.

## How to Spawn

```
subagent_spawn({
  name: "EchoSpark",
  task: "Analyze SOL/USDC 4h chart. Check support/resistance levels. Write findings to knowledge/subagents/sol-analysis.md",
  allow_trades: false,
  max_iterations: 25
})
```

### Parameters
- **name** (required): Choose a unique Echo-prefixed name. Be creative — EchoSpark, EchoNibble, EchoGhost, EchoVolt, EchoFrost, EchoPulse, EchoDrift, EchoBlaze, etc.
- **task** (required): Full task description. Include:
  - What to do
  - Which chains/tokens to focus on
  - Where to write results (`knowledge/subagents/filename.md`)
  - What skill references to read if needed
  - Context from your current analysis
- **allow_trades** (optional, default: false): Set to `true` if the subagent needs to execute on-chain transactions.
- **max_iterations** (optional, default: 25): Max tool call iterations.

## Limits

- Max 3 concurrent subagents
- Each subagent has 5 minute timeout
- Each subagent has 40K token context window

## Tool Access

Subagents get the same tools you have — web search, file read/write, CLI commands, etc. They can read your skills by using `file_read`.

**Without `allow_trades`**: Subagent cannot execute mutating CLI tools (swaps, transfers, bridges). Read-only chain access.
**With `allow_trades: true`**: Full execution rights. Use this when you need a subagent to actually trade.

## Memory Rules

- Subagents can READ your shared memory (it's in their system prompt)
- Subagents CANNOT write to shared memory — only you can
- Subagents write results to `knowledge/subagents/` folder
- After a subagent completes, review its output and decide what to save to your memory

## Shared Workspace

Use `knowledge/subagents/` as the collaboration space:
- Tell each subagent where to write: `knowledge/subagents/task-name.md`
- Subagents can read each other's files if you tell them to
- You orchestrate — provide context in the task about what other subagents are doing

## Workflow

1. **Spawn**: Create subagent with clear task + output location
2. **Continue**: Keep working — don't wait. Do your own analysis or spawn more subagents.
3. **Check**: Use `subagent_status` to see if they're done
4. **Collect**: Read their output from `knowledge/subagents/`
5. **Synthesize**: Combine findings into your decision. Save important insights to your memory.
6. **Cleanup**: Stop subagents that are no longer needed

## Example: Parallel Market Analysis

```
// Spawn 3 researchers in parallel
subagent_spawn({name: "EchoScout", task: "Search for trending Solana tokens on DexScreener. Focus on tokens with >$100K volume in last 4h. Write top 5 to knowledge/subagents/trending-sol.md"})

subagent_spawn({name: "EchoSentry", task: "Check all open positions in portfolio. Calculate current PnL for each. Write report to knowledge/subagents/portfolio-check.md"})

subagent_spawn({name: "EchoProbe", task: "Research Polymarket — find prediction markets with >60% confidence and upcoming resolution. Write opportunities to knowledge/subagents/polymarket-opps.md"})

// Continue your own work while they research
// ...later...
subagent_status()  // Check who's done
file_read({path: "knowledge/subagents/trending-sol.md"})  // Read findings
```

## Important

- You CANNOT spawn subagents that spawn other subagents (no cascading)
- Always provide enough context in the task — the subagent starts fresh
- Name your subagents meaningfully for the UI (user sees them in the panel)
- Clean up `knowledge/subagents/` periodically — stale files waste space
