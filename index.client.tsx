import type { PluginClientContext } from "@getpaseo/plugin/client";
import { RepoDiffPanel } from "./client/diff-panel";
import { ReposPanel } from "./client/panel";
import { setClient } from "./client/store";

export default function contribute(client: PluginClientContext) {
  setClient(client);

  client.addWorkspacePanel({
    id: "repos",
    title: "Repos",
    icon: "FolderGit2",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: ReposPanel,
  });

  client.addWorkspacePanel({
    id: "repos-diff",
    title: "Repo diff",
    icon: "FileDiff",
    context: "workspace",
    locations: ["workspace"],
    Component: RepoDiffPanel,
  });

  client.addCommandCenterItem({
    id: "open-repos",
    title: "Open multi-repo changes",
    icon: "FolderGit2",
    keywords: ["git", "repos", "diff", "changes"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("repos", { location: "explorer" });
    },
  });

  return () => {};
}
