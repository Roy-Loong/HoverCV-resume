import { openDB } from "idb";
import { projectSchema, type Project } from "./schema";
const db = () =>
  openDB("hovercv", 1, {
    upgrade(db) {
      db.createObjectStore("projects", { keyPath: "id" });
    },
  });
export async function saveLocal(project: Project) {
  await (await db()).put("projects", project);
  localStorage.setItem("hovercv:last", project.id);
}
export async function loadLast() {
  const id = localStorage.getItem("hovercv:last");
  if (!id) return null;
  const value = await (await db()).get("projects", id);
  const parsed = projectSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
