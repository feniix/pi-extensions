import { describe, expect, it, vi } from "vitest";
import {
  buildItermViewerScript,
  type ItermViewerCommandAdapter,
  inspectItermViewerAvailability,
  openItermTmuxViewer,
} from "../extensions/iterm-viewer.js";

describe("iTerm2 tmux viewer", () => {
  it("escapes AppleScript strings when opening a read-only tmux viewer", async () => {
    const adapter: ItermViewerCommandAdapter = { execFile: vi.fn(async () => ({ stdout: "", stderr: "" })) };
    const attachCommand = "tmux -S '/tmp/socket with space' attach-session -r -t 'pi-cond-\"run'";

    const result = await openItermTmuxViewer({
      attachCommand,
      title: 'Run "A"',
      platform: "darwin",
      adapter,
    });

    expect(result).toMatchObject({ status: "opened", diagnostic: null, command: attachCommand });
    expect(adapter.execFile).toHaveBeenCalledWith(
      "osascript",
      ["-e", expect.stringContaining('write text "tmux -S')],
      undefined,
    );
    const script = (adapter.execFile as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.[1] as string;
    expect(script).toContain('set name to "Run \\"A\\""');
    expect(script).toContain("attach-session -r -t 'pi-cond-\\\"run'");
  });

  it("reports unavailable instead of launching outside macOS", async () => {
    const adapter: ItermViewerCommandAdapter = { execFile: vi.fn(async () => ({ stdout: "", stderr: "" })) };

    const result = await openItermTmuxViewer({
      attachCommand: "tmux attach -r",
      platform: "linux",
      adapter,
    });

    expect(result).toMatchObject({ status: "unavailable", diagnostic: expect.stringContaining("macOS") });
    expect(adapter.execFile).not.toHaveBeenCalled();
  });

  it("returns a warning when iTerm2 launch fails", async () => {
    const adapter: ItermViewerCommandAdapter = {
      execFile: vi.fn(async () => {
        throw new Error("iTerm2 not found");
      }),
    };

    const result = await openItermTmuxViewer({
      attachCommand: "tmux attach -r",
      platform: "darwin",
      adapter,
    });

    expect(result).toMatchObject({ status: "warning", diagnostic: expect.stringContaining("iTerm2 not found") });
  });

  it("builds a script that activates iTerm2 and writes the attach command", () => {
    expect(buildItermViewerScript({ attachCommand: "tmux attach -r", title: "Conductor" })).toContain(
      'tell application "iTerm"',
    );
  });

  it("detects iTerm2 viewer availability without probing on non-macOS platforms", () => {
    const probe = vi.fn();

    expect(inspectItermViewerAvailability({ platform: "linux", probe })).toMatchObject({
      available: false,
      diagnostic: expect.stringContaining("macOS"),
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it("reports macOS iTerm2 probe success and failure", () => {
    expect(inspectItermViewerAvailability({ platform: "darwin", probe: () => undefined })).toMatchObject({
      available: true,
      diagnostic: null,
    });
    expect(
      inspectItermViewerAvailability({
        platform: "darwin",
        probe: () => {
          throw new Error("iTerm is missing");
        },
      }),
    ).toMatchObject({ available: false, diagnostic: expect.stringContaining("iTerm is missing") });
  });
});
