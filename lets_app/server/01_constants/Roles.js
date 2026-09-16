/**
 * Roles.js
 * Workflow stages + their UI labels. Per Phase 3 §3 this file is also the
 * eventual home for ROLES + MODES (extracted from inline string literals)
 * — that adoption happens in Chunk 8 (sheet/status/role literal adoption).
 */

const WORKFLOW_CONFIG = {
  TOTAL_FORM_STEPS: 6,
  STAGES: ['Sector', 'BU', 'OSO', 'FAS'],
  STAGE_LABELS: {
    'Sector': 'SD',
    'BU': 'BU',
    'OSO': 'FO',
    'FAS': 'FAS'
  }
};
