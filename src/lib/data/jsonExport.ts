import { invoke, isTauri } from "@tauri-apps/api/core";

export async function exportJsonFile(filename: string, content: string): Promise<string> {
  if (isTauri()) {
    return invoke<string>("save_json_export", { filename, content });
  }

  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}
