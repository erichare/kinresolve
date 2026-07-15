import { provisionArchive } from "@/lib/archive-provisioning";
import type { DatasetMode } from "@/lib/hosted-config";
import type { WorkspaceStoreOptions } from "@/lib/workspace-store";

export async function provisionTestArchive(
  options: WorkspaceStoreOptions,
  datasetMode: DatasetMode = "demo"
): Promise<void> {
  await provisionArchive(datasetMode, options);
}
