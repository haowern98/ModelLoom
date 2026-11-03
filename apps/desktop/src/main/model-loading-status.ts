/** Display-only startup milestones from the existing owned-runtime diagnostics. */
export function createModelLoadingStatus() {
  let stage = 0;
  let observing = false;
  return {
    get stage() {
      return stage;
    },
    begin() {
      stage = 0;
      observing = true;
    },
    observe(message: string) {
      if (!observing) return;
      if (message.startsWith('load.begin ')) stage = 1;
      else if (stage > 0) {
        if (message === 'load.memory-admitted') stage = Math.max(stage, 2);
        else if (message.startsWith('native.launch ')) stage = Math.max(stage, 3);
        else if (message.startsWith('native.captured ')) stage = Math.max(stage, 4);
        else if (message.startsWith('native.ready ')) {
          stage = 5;
          observing = false;
        } else if (/^(?:stop\.|native\.exit |native\.force-stop )/u.test(message))
          observing = false;
      }
    },
  };
}

export type ModelLoadingStatus = ReturnType<typeof createModelLoadingStatus>;
