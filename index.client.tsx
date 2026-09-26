import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ReposPanel } from "./client/panel";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "repos",
    title: "Repos",
    icon: "FolderGit2",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: ReposPanel,
  });

  client.addCommandCenterItem({
    id: "open-repos",
    title: "Open multi-repo changes",
    icon: "FolderGit2",
    keywords: ["git", "repos", "diff", "changes"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("repos");
    },
  });

  return () => {};
}
