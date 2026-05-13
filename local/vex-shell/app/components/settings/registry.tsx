import React from "react";
import type { SettingsTabId, Store } from "../../state/store.js";
import type { InkKey } from "./logic.js";
import {
  ApprovalsTab,
  handleApprovalsInput,
  handleMissionInput,
  handleProviderInput,
  handleSessionInput,
  handleToolsInput,
  MissionTab,
  ProviderTab,
  SessionTab,
  ToolsTab,
} from "./tabsMain.js";
import {
  DiagnosticsTab,
  handleKnowledgeInput,
  handleServicesInput,
  KnowledgeTab,
  ServicesTab,
} from "./tabsRuntime.js";
import {
  handleSubagentsInput,
  SubagentsTab,
} from "./tabsSubagents.js";
import {
  AdvancedTab,
  ConfigTab,
  EnvTab,
  handleAdvancedInput,
  handleConfigInput,
  handleEnvInput,
} from "./tabsConfig.js";

export function TabContent({
  store,
  tab,
}: {
  store: Store;
  tab: SettingsTabId;
}): React.JSX.Element {
  switch (tab) {
    case "provider":
      return <ProviderTab store={store} />;
    case "session":
      return <SessionTab store={store} />;
    case "mission":
      return <MissionTab store={store} />;
    case "approvals":
      return <ApprovalsTab store={store} />;
    case "tools":
      return <ToolsTab store={store} />;
    case "knowledge":
      return <KnowledgeTab store={store} />;
    case "subagents":
      return <SubagentsTab store={store} />;
    case "diagnostics":
      return <DiagnosticsTab store={store} />;
    case "services":
      return <ServicesTab />;
    case "env":
      return <EnvTab store={store} />;
    case "config":
      return <ConfigTab store={store} />;
    case "advanced":
      return <AdvancedTab store={store} />;
  }
}

export function handleTabInput(
  store: Store,
  tab: SettingsTabId,
  input: string,
  key: InkKey,
): void {
  switch (tab) {
    case "provider":
      handleProviderInput(store, input);
      return;
    case "session":
      handleSessionInput(store, input, key);
      return;
    case "mission":
      handleMissionInput(store, input);
      return;
    case "approvals":
      handleApprovalsInput(store, input, key);
      return;
    case "tools":
      handleToolsInput(store, input, key);
      return;
    case "knowledge":
      handleKnowledgeInput(store, input);
      return;
    case "subagents":
      handleSubagentsInput(store, input, key);
      return;
    case "services":
      handleServicesInput(store, input);
      return;
    case "env":
      handleEnvInput(store, input, key);
      return;
    case "config":
      handleConfigInput(store, input, key);
      return;
    case "advanced":
      handleAdvancedInput(store, input, key);
      return;
    case "diagnostics":
      return;
  }
}
