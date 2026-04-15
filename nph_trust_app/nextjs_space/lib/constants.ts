export const PATHWAY_STAGES = [
  { type: 'SYMPTOM_SCREENING', name: 'Symptom Screening', sortOrder: 1, description: 'Gait, cognition, and urinary symptom scoring' },
  { type: 'IMAGING', name: 'Imaging', sortOrder: 2, description: 'Evans index, callosal angle, DESH grade, ventricular volume' },
  { type: 'SPECIALIST_REVIEW', name: 'Specialist Review', sortOrder: 3, description: 'Neurosurgery/neurology assessment' },
  { type: 'CSF_TESTING', name: 'CSF Testing', sortOrder: 4, description: 'Tap test results, extended lumbar drainage' },
  { type: 'TREATMENT_DECISION', name: 'Treatment Decision', sortOrder: 5, description: 'Proceed / defer / contraindicated' },
  { type: 'SHUNT_INTERVENTION', name: 'Shunt Intervention', sortOrder: 6, description: 'Procedure details, date, valve type' },
  { type: 'FOLLOW_UP', name: 'Follow-Up', sortOrder: 7, description: 'Outcomes at 3mo, 6mo, 12mo' },
] as const;

export const STAGE_COLORS: Record<string, string> = {
  SYMPTOM_SCREENING: '#60B5FF',
  IMAGING: '#FF9149',
  SPECIALIST_REVIEW: '#80D8C3',
  CSF_TESTING: '#A19AD3',
  TREATMENT_DECISION: '#FF9898',
  SHUNT_INTERVENTION: '#FF90BB',
  FOLLOW_UP: '#72BF78',
};

export const STATUS_COLORS: Record<string, string> = {
  PENDING: '#94a3b8',
  IN_PROGRESS: '#60B5FF',
  COMPLETED: '#72BF78',
  SKIPPED: '#d4d4d4',
  CANCELLED: '#ef4444',
  FAILED: '#FF6363',
};

export const ATTESTATION_STATUS_COLORS: Record<string, string> = {
  DRAFT: '#94a3b8',
  HASHED: '#60B5FF',
  SIGNED: '#3B82F6',
  ANCHOR_PENDING: '#FF9149',
  ANCHORED: '#72BF78',
  FAILED: '#FF6363',
  REVERIFIED: '#A19AD3',
};
