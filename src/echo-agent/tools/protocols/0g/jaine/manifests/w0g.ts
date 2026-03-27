import type { ProtocolToolManifest } from "../../../types.js";

export const W0G_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "jaine.w0g.wrap",
    namespace: "jaine",
    lifecycle: "active",
    description: "Wrap native 0G into w0G (ERC-20). Required before swapping native 0G on Jaine DEX.",
    mutating: true,
    params: [
      { key: "amount", type: "string", required: true, description: "Amount of native 0G to wrap (human-readable units)." },
    ],
    exampleParams: { amount: "10.0" },
  },
  {
    toolId: "jaine.w0g.unwrap",
    namespace: "jaine",
    lifecycle: "active",
    description: "Unwrap w0G back to native 0G token.",
    mutating: true,
    params: [
      { key: "amount", type: "string", required: true, description: "Amount of w0G to unwrap (human-readable units)." },
    ],
    exampleParams: { amount: "10.0" },
  },
];
