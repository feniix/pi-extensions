/**
 * ThoughtStorage - Persistence layer for sequential thinking sessions
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type ThoughtData, thoughtFromDict, thoughtToDict } from "./types.js";

// =============================================================================
// Storage Class
// =============================================================================

export class ThoughtStorage {
  private thoughts: ThoughtData[] = [];
  private readonly storageDir: string;
  private readonly currentSessionFile: string;

  constructor(storageDir?: string) {
    if (storageDir) {
      this.storageDir = storageDir;
    } else {
      this.storageDir = join(homedir(), ".mcp_sequential_thinking");
    }

    // Ensure storage directory exists
    mkdirSync(this.storageDir, { recursive: true });

    this.currentSessionFile = join(this.storageDir, "current_session.json");

    // Load existing session
    this.loadSession();
  }

  // =============================================================================
  // Public API
  // =============================================================================

  addThought(thought: ThoughtData): void {
    this.thoughts.push(thought);
    this.saveSession();
  }

  getAllThoughts(): ThoughtData[] {
    // Return a copy to prevent external modification
    return [...this.thoughts];
  }

  clearHistory(): void {
    this.thoughts = [];
    this.saveSession();
  }

  exportSession(filePath: string): void {
    const exportData = {
      thoughts: this.thoughts.map((t) => thoughtToDict(t, true)),
      lastUpdated: new Date().toISOString(),
      exportedAt: new Date().toISOString(),
      metadata: {
        totalThoughts: this.thoughts.length,
        stages: this.getStageCounts(),
      },
    };

    this.saveToFile(filePath, exportData);
  }

  importSession(filePath: string): void {
    const loadedThoughts = this.loadFromFile(filePath);
    this.thoughts = loadedThoughts;
    this.saveSession();
  }

  // =============================================================================
  // Private Methods
  // =============================================================================

  private loadSession(): void {
    this.thoughts = this.loadFromFile(this.currentSessionFile);
  }

  private saveSession(): void {
    const data = {
      thoughts: this.thoughts.map((t) => thoughtToDict(t, true)),
      lastUpdated: new Date().toISOString(),
    };

    this.saveToFile(this.currentSessionFile, data);
  }

  private loadFromFile(filePath: string): ThoughtData[] {
    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const data = JSON.parse(content);

      if (!data || !Array.isArray(data.thoughts)) {
        // Handle legacy format (array directly)
        if (Array.isArray(data)) {
          return data.map((item) => thoughtFromDict(item as Record<string, unknown>));
        }
        return [];
      }

      return data.thoughts.map((item: Record<string, unknown>) => thoughtFromDict(item));
    } catch (error) {
      // Handle corrupted file - create backup and return empty
      console.warn(`[pi-sequential-thinking] Error loading ${filePath}: ${error}`);
      this.backupCorruptedFile(filePath);
      return [];
    }
  }

  private saveToFile(filePath: string, data: Record<string, unknown>): void {
    // Ensure parent directory exists
    mkdirSync(dirname(filePath), { recursive: true });

    const lockPath = `${filePath}.lock`;

    // Simple file locking simulation using atomic write
    // In production, you'd use a proper file locking library
    this.acquireLock(lockPath);
    try {
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf-8");
      // Atomic rename
      renameSync(tempPath, filePath);
    } finally {
      this.releaseLock(lockPath);
    }
  }

  private acquireLock(_lockPath: string): void {
    // Simplified locking - in production use proper file locking
    // The atomic rename pattern above provides reasonable safety
  }

  private releaseLock(_lockPath: string): void {
    // Simplified locking release
  }

  private backupCorruptedFile(filePath: string): void {
    if (!existsSync(filePath)) {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${filePath}.bak.${timestamp}`;

    try {
      renameSync(filePath, backupPath);
      console.log(`[pi-sequential-thinking] Backed up corrupted file to ${backupPath}`);
    } catch {
      console.warn(`[pi-sequential-thinking] Could not backup corrupted file ${filePath}`);
    }
  }

  private getStageCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const thought of this.thoughts) {
      counts[thought.stage] = (counts[thought.stage] || 0) + 1;
    }
    return counts;
  }
}
