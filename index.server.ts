import type { PluginServerContext } from "@getpaseo/plugin/server";
import { reposDiff, reposSnapshot } from "./shared/repos";
import { diffHandler, snapshotHandler } from "./server/handlers";

export default function contribute(server: PluginServerContext) {
  server.handle(reposSnapshot, snapshotHandler);
  server.handle(reposDiff, diffHandler);
  return () => {};
}
