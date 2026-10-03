/**
 * Skill-shaped export bundle types (architecture: see the Artifact Management topic in the project Wiki).
 */

export type SkillExportDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface SkillExportDiagnostic {
  severity: SkillExportDiagnosticSeverity;
  code: string;
  message: string;
}

export interface SkillExportFile {
  path: string;
  content: string | Buffer;
  contentType: string;
  sha256: string;
  executable?: boolean;
}

export interface SkillExportItem {
  slug: string;
  name: string;
  description: string;
  squadrulesUri: string;
  adapterVersion?: string | null;
  files: SkillExportFile[];
  diagnostics: SkillExportDiagnostic[];
}
