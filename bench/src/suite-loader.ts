import { readFile, readdir } from "fs/promises";
import { join, extname } from "path";
import type { TestSuite } from "./types.js";

export async function loadSuite(filePath: string): Promise<TestSuite> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as TestSuite;
}

export async function loadAllSuites(
  directory: string
): Promise<TestSuite[]> {
  const files = await readdir(directory);
  const jsonFiles = files.filter((f) => extname(f) === ".json");

  const suites: TestSuite[] = [];
  for (const file of jsonFiles) {
    const suite = await loadSuite(join(directory, file));
    suites.push(suite);
  }

  return suites;
}
