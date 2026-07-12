import { Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { getExaRenderers } from "../extensions/tui-renderers.js";

const theme = {
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
};

function renderComponent(component: Text): string {
  return component.render(200).join("\n");
}

function renderResult(toolName: string, text: string, expanded = false, lastComponent?: Text): Text {
  const renderer = getExaRenderers(toolName).renderResult;
  expect(renderer).toBeTypeOf("function");
  return renderer?.({ content: [{ type: "text", text }] }, { expanded }, theme, { lastComponent }) as Text;
}

describe("pi-exa TUI renderers", () => {
  it.each([
    "web_search_exa",
    "web_fetch_exa",
    "web_answer_exa",
    "web_find_similar_exa",
    "web_research_exa",
    "web_search_advanced_exa",
  ])("registers call and result renderers for %s", (toolName) => {
    const renderers = getExaRenderers(toolName);
    expect(renderers.renderCall).toBeTypeOf("function");
    expect(renderers.renderResult).toBeTypeOf("function");
  });

  it("does not register renderers for local planner tools", () => {
    expect(getExaRenderers("exa_research_step")).toEqual({});
  });

  it("summarizes search results in collapsed mode", () => {
    const component = renderResult(
      "web_search_exa",
      "Title: First\nURL: https://first.example\nSummary:\nOne\n\n---\n\nTitle: Second\nURL: https://second.example",
    );

    expect(renderComponent(component)).toContain("First — https://first.example");
    expect(renderComponent(component)).toContain("Second — https://second.example");
    expect(renderComponent(component)).not.toContain("Summary:");
  });

  it("shows successful fetch metadata in collapsed mode", () => {
    const component = renderResult("web_fetch_exa", "# Example page\nURL: https://example.com\n\nPage body");

    expect(renderComponent(component)).toContain("# Example page");
    expect(renderComponent(component)).toContain("URL: https://example.com");
    expect(renderComponent(component)).not.toContain("Page body");
  });

  it.each([
    "Exa API key not configured. Set EXA_API_KEY or use --exa-api-key flag.",
    "web_fetch_exa timed out after 60000ms.",
    "Cancelled.",
  ])("preserves non-page fetch results in collapsed mode: %s", (message) => {
    const component = renderResult("web_fetch_exa", message);

    expect(renderComponent(component)).toContain(message);
    expect(renderComponent(component)).not.toContain("# (no title)");
  });

  it("truncates expanded output and reports omitted characters", () => {
    const component = renderResult("web_research_exa", "x".repeat(8_010), true);

    expect(renderComponent(component)).toContain("… (truncated, 10 more chars)");
  });

  it("reuses the previous component", () => {
    const previous = new Text("old", 0, 0);
    const component = renderResult("web_answer_exa", "new answer", false, previous);

    expect(component).toBe(previous);
    expect(renderComponent(component)).toContain("new answer");
  });
});
