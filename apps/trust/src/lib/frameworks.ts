const FRAMEWORK_LABELS: Record<string, string> = {
  soc2: 'SOC 2',
  soc2_type1: 'SOC 2 Type 1',
  soc2_type2: 'SOC 2 Type 2',
  soc3: 'SOC 3',
  iso_27001: 'ISO 27001',
  iso_42001: 'ISO 42001',
  iso_9001: 'ISO 9001',
  nen_7510: 'NEN 7510',
  gdpr: 'GDPR',
  hipaa: 'HIPAA',
  pci_dss: 'PCI DSS',
  pipeda: 'PIPEDA',
  ccpa: 'CCPA',
};

export function frameworkLabel(framework: string): string {
  return FRAMEWORK_LABELS[framework] ?? framework.replace(/_/g, ' ').toUpperCase();
}

export const STATUS_LABELS = {
  compliant: 'Compliant',
  in_progress: 'In progress',
  started: 'Started',
} as const;
