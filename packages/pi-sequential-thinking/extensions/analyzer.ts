/**
 * ThoughtAnalyzer - Analysis and insights for sequential thinking
 */

import type { ThoughtData } from "./types.js";

// =============================================================================
// ThoughtAnalyzer Class
// =============================================================================

export class ThoughtAnalyzer {
  private getSameStageThoughts(currentThought: ThoughtData, allThoughts: ThoughtData[]): ThoughtData[] {
    return allThoughts.filter(
      (thought) => this.isDifferentThought(thought, currentThought) && thought.stage === currentThought.stage,
    );
  }

  private getTagRelatedThoughts(currentThought: ThoughtData, allThoughts: ThoughtData[]): ThoughtData[] {
    if (currentThought.tags.length === 0) {
      return [];
    }

    return allThoughts
      .map((thought) => ({
        thought,
        matchCount: this.countMatchingTags(currentThought, thought),
      }))
      .filter(({ thought, matchCount }) => this.isDifferentThought(thought, currentThought) && matchCount > 0)
      .sort((a, b) => b.matchCount - a.matchCount)
      .map(({ thought }) => thought);
  }

  private countMatchingTags(currentThought: ThoughtData, candidateThought: ThoughtData): number {
    return currentThought.tags.filter((tag) => candidateThought.tags.includes(tag)).length;
  }

  private isDifferentThought(thought: ThoughtData, currentThought: ThoughtData): boolean {
    return thought.id !== currentThought.id;
  }

  private mergeThoughtsWithLimit(thoughtGroups: ThoughtData[][], maxResults: number): ThoughtData[] {
    const combined: ThoughtData[] = [];
    const seenIds = new Set<string>();

    for (const thoughts of thoughtGroups) {
      for (const thought of thoughts) {
        if (seenIds.has(thought.id)) {
          continue;
        }

        combined.push(thought);
        seenIds.add(thought.id);

        if (combined.length >= maxResults) {
          return combined;
        }
      }
    }

    return combined;
  }

  /**
   * Find thoughts related to the current thought.
   * Related thoughts are those in the same stage or sharing similar tags.
   */
  findRelatedThoughts(currentThought: ThoughtData, allThoughts: ThoughtData[], maxResults = 3): ThoughtData[] {
    const sameStageThoughts = this.getSameStageThoughts(currentThought, allThoughts);
    const tagRelatedThoughts = this.getTagRelatedThoughts(currentThought, allThoughts);

    return this.mergeThoughtsWithLimit([sameStageThoughts, tagRelatedThoughts], maxResults);
  }

  /**
   * Analyze a single thought in context of all thoughts.
   */
  analyzeThought(
    thought: ThoughtData,
    allThoughts: ThoughtData[],
  ): {
    thoughtAnalysis: {
      currentThought: {
        thoughtNumber: number;
        totalThoughts: number;
        nextThoughtNeeded: boolean;
        stage: string;
        tags: string[];
        timestamp: string;
      };
      analysis: {
        relatedThoughtsCount: number;
        relatedThoughtSummaries: Array<{
          thoughtNumber: number;
          stage: string;
          snippet: string;
        }>;
        progress: number;
        isFirstInStage: boolean;
      };
      context: {
        thoughtHistoryLength: number;
        currentStage: string;
      };
    };
  } {
    // Find related thoughts
    const relatedThoughts = this.findRelatedThoughts(thought, allThoughts);

    // Check if this is the first thought in its stage
    const sameStageThoughts = allThoughts.filter((t) => t.stage === thought.stage);
    const isFirstInStage = sameStageThoughts.every((t) => t.thought_number >= thought.thought_number);

    // Calculate progress
    const progress = (thought.thought_number / thought.total_thoughts) * 100;

    return {
      thoughtAnalysis: {
        currentThought: {
          thoughtNumber: thought.thought_number,
          totalThoughts: thought.total_thoughts,
          nextThoughtNeeded: thought.next_thought_needed,
          stage: thought.stage,
          tags: thought.tags,
          timestamp: thought.timestamp,
        },
        analysis: {
          relatedThoughtsCount: relatedThoughts.length,
          relatedThoughtSummaries: relatedThoughts.map((t) => ({
            thoughtNumber: t.thought_number,
            stage: t.stage,
            snippet: t.thought.length > 100 ? `${t.thought.slice(0, 100)}...` : t.thought,
          })),
          progress,
          isFirstInStage,
        },
        context: {
          thoughtHistoryLength: allThoughts.length,
          currentStage: thought.stage,
        },
      },
    };
  }

  /**
   * Generate a summary of the entire thinking process.
   */
  generateSummary(thoughts: ThoughtData[]): { summary: SummaryData | string } {
    if (thoughts.length === 0) {
      return { summary: "No thoughts recorded yet" };
    }

    // Group thoughts by stage
    const stages: Record<string, ThoughtData[]> = {};
    for (const thought of thoughts) {
      if (!stages[thought.stage]) {
        stages[thought.stage] = [];
      }
      stages[thought.stage].push(thought);
    }

    // Count tags
    const tagCounts = new Map<string, number>();
    for (const thought of thoughts) {
      for (const tag of thought.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }

    // Get top 5 tags
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));

    // Calculate completion status
    const maxTotal = Math.max(...thoughts.map((t) => t.total_thoughts), 0);
    const percentComplete = maxTotal > 0 ? (thoughts.length / maxTotal) * 100 : 0;

    // Check if all stages are represented
    const allStagesPresent = Object.keys(stages).length === 5;

    // Create timeline
    const sortedThoughts = [...thoughts].sort((a, b) => a.thought_number - b.thought_number);
    const timeline = sortedThoughts.map((t) => ({
      number: t.thought_number,
      stage: t.stage,
    }));

    const summary: SummaryData = {
      totalThoughts: thoughts.length,
      stages: Object.fromEntries(
        Object.entries(stages).map(([stage, thoughtsList]) => [stage, thoughtsList.length]),
      ) as Record<string, number>,
      timeline,
      topTags,
      completionStatus: {
        hasAllStages: allStagesPresent,
        percentComplete,
      },
    };

    return { summary };
  }
}

export interface SummaryData {
  totalThoughts: number;
  stages: Record<string, number>;
  timeline: Array<{ number: number; stage: string }>;
  topTags: Array<{ tag: string; count: number }>;
  completionStatus: {
    hasAllStages: boolean;
    percentComplete: number;
  };
}
