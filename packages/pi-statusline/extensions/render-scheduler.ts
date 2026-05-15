export type RenderCallback = () => void;

export type RenderScheduler = {
  clear(): void;
  rerender(immediate?: boolean): void;
  setRenderCallback(callback: RenderCallback | null): void;
};

export function createRenderScheduler(
  throttleMs: number,
  isRecoverableRenderError: (error: unknown) => boolean,
): RenderScheduler {
  let renderCallback: RenderCallback | null = null;
  let renderTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastRenderAt = 0;

  const clearTimeoutIfNeeded = () => {
    if (renderTimeout) {
      clearTimeout(renderTimeout);
      renderTimeout = null;
    }
  };

  const requestRender = () => {
    try {
      renderCallback?.();
    } catch (error) {
      if (!isRecoverableRenderError(error)) {
        throw error;
      }
      clearTimeoutIfNeeded();
      renderCallback = null;
      lastRenderAt = 0;
    }
  };

  return {
    clear() {
      clearTimeoutIfNeeded();
      renderCallback = null;
      lastRenderAt = 0;
    },

    rerender(immediate = false) {
      if (!renderCallback) {
        return;
      }

      const now = Date.now();
      if (immediate || lastRenderAt === 0 || now - lastRenderAt >= throttleMs) {
        clearTimeoutIfNeeded();
        lastRenderAt = now;
        requestRender();
        return;
      }

      if (renderTimeout) {
        return;
      }

      renderTimeout = setTimeout(
        () => {
          renderTimeout = null;
          lastRenderAt = Date.now();
          requestRender();
        },
        throttleMs - (now - lastRenderAt),
      );
    },

    setRenderCallback(callback: RenderCallback | null) {
      renderCallback = callback;
      lastRenderAt = 0;
      if (!callback) {
        clearTimeoutIfNeeded();
      }
    },
  };
}
