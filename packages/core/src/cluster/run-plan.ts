import { isDeepStrictEqual } from 'node:util';
import type { ClusterDraft, SavedClusterConfiguration } from './contracts.js';
import { decodeSavedClusterConfiguration, decodeClusterDraft } from './contracts.js';
import { resolveClusterLoad } from './effective-load.js';
import { validateAssignment } from './placement.js';
/** Immutable session intent from an acknowledged draft. No named configuration is written. */
export function captureClusterDraft(
  input: ClusterDraft,
  revision: number,
  blockCount: number,
  profileId: string,
  id: string,
): SavedClusterConfiguration {
  const draft = decodeClusterDraft(input);
  if (draft.revision !== revision) throw Error('STALE_CONFIGURATION');
  const valid = validateAssignment(draft, blockCount);
  if (!valid.ok) throw Error('INVALID_CLUSTER_CONFIGURATION');
  return decodeSavedClusterConfiguration({
    id,
    name: 'Current allocation',
    revision,
    modelId: draft.modelId,
    blockCount,
    profileId,
    load: draft.load,
    runs: valid.runs,
    ...(draft.proposerDevice === undefined ? {} : { proposerDevice: draft.proposerDevice }),
  });
}
/** Capture immutable saved intent. Caller selection and draft JSON are never an active session. */
export function captureClusterRun(
  input: SavedClusterConfiguration,
  revision: number,
  draft: ClusterDraft | null,
  artifact: string,
) {
  const saved = decodeSavedClusterConfiguration(input);
  const validated = draft ? validateAssignment(draft, saved.blockCount) : null;
  if (saved.revision !== revision) throw Error('STALE_CONFIGURATION');
  if (
    draft &&
    (draft.modelId !== saved.modelId ||
      draft.configurationId !== saved.id ||
      draft.baseSavedRevision !== saved.revision ||
      !isDeepStrictEqual(draft.load, saved.load) ||
      draft.proposerDevice !== saved.proposerDevice ||
      !validated?.ok ||
      !isDeepStrictEqual(
        validated.runs,
        [...saved.runs].sort((a, b) => a.first - b.first),
      ))
  )
    throw Error('UNSAVED_CONFIGURATION');
  return resolveClusterLoad(saved, artifact);
}
