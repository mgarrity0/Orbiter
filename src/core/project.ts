// Project save/load. A project file captures the user's whole editing
// state so closing + reopening Orbiter lands them exactly where they
// were: dome geometry, color pipeline, controller topology, motion
// config, feature flags, and the name of the last-loaded pattern.
//
// We deliberately do NOT serialize the pattern's source — patterns live
// on disk under {project-root}/patterns/ and are identified by filename.
// That way project files stay small and round-trip cleanly across
// machines that share a patterns/ folder.
//
// Format version is bumped when the schema changes in a way that older
// clients can't read. Keep migration code in loadProject().

import type { Structure } from './structure';
import type { ColorConfig } from './colorSpace';
import type { Topology } from './topology';
import type { MotionConfig } from './motion';

export const PROJECT_FORMAT_VERSION = 1;

export type FeatureFlagsSnapshot = {
  bloom: boolean;
  hdr: boolean;
};

export type ProjectFile = {
  formatVersion: number;
  name: string;
  savedAt: string; // ISO-8601
  structure: Structure;
  colorConfig: ColorConfig;
  topology: Topology;
  motionConfig: MotionConfig;
  featureFlags: FeatureFlagsSnapshot;
  activePatternName: string | null;
};

export type ProjectSnapshot = Omit<ProjectFile, 'formatVersion' | 'savedAt'>;

export function buildProjectFile(snap: ProjectSnapshot): ProjectFile {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name: snap.name,
    savedAt: new Date().toISOString(),
    structure: snap.structure,
    colorConfig: snap.colorConfig,
    topology: snap.topology,
    motionConfig: snap.motionConfig,
    featureFlags: snap.featureFlags,
    activePatternName: snap.activePatternName,
  };
}

// Accepts a raw object parsed from disk, validates minimally, and
// returns a narrowed ProjectFile. Throws with a human-readable message
// if the file is unreadable; UI should surface it.
export function parseProjectFile(raw: unknown): ProjectFile {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Project file is not an object');
  }
  const obj = raw as Record<string, unknown>;
  const version = obj.formatVersion;
  if (typeof version !== 'number') {
    throw new Error('Missing formatVersion');
  }
  if (version > PROJECT_FORMAT_VERSION) {
    throw new Error(
      `Project was saved with a newer Orbiter (format v${version}); this build supports v${PROJECT_FORMAT_VERSION}`,
    );
  }
  // v1 is the only extant version; no migrations yet.
  for (const key of ['structure', 'colorConfig', 'topology', 'motionConfig', 'featureFlags']) {
    if (!obj[key] || typeof obj[key] !== 'object') {
      throw new Error(`Missing or invalid ${key}`);
    }
  }
  return obj as unknown as ProjectFile;
}
