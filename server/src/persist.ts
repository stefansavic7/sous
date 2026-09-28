import type { Persistence, SousData } from "./store.ts";

/** JSON-file persistence for the self-hosted server (Node only). */
export async function filePersistence(path: string): Promise<Persistence> {
  const fs = await import("node:fs");
  const nodePath = await import("node:path");
  return {
    load() {
      try {
        return JSON.parse(fs.readFileSync(path, "utf8")) as SousData;
      } catch {
        return undefined;
      }
    },
    save(data) {
      fs.mkdirSync(nodePath.dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, path);
    },
  };
}
