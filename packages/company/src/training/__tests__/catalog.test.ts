import { describe, expect, it } from 'bun:test';
import {
  TRAINING_GROUPS,
  getTrainingGroup,
  groupForModule,
  requiredTrainingGroups,
} from '../catalog';
import { TRAINING_VALIDITY_DAYS } from '../constants';
import {
  CCPA_FRAMEWORK_NAME,
  HIPAA_FRAMEWORK_NAME,
  ccpaFrameworkInstanceWhere,
  hipaaFrameworkInstanceWhere,
} from '../frameworks';
import {
  CCPA_TRAINING_VIDEO_IDS,
  GENERAL_TRAINING_VIDEO_IDS,
  HIPAA_TRAINING_ID,
  isTrainingVideoId,
} from '../ids';

describe('training catalog', () => {
  it('defines general, hipaa and ccpa groups with unique ids', () => {
    const ids = TRAINING_GROUPS.map((group) => group.id);

    expect([...ids].sort()).toEqual(['ccpa', 'general', 'hipaa']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('maps each group to its canonical modules', () => {
    expect(getTrainingGroup('general').moduleIds).toEqual([...GENERAL_TRAINING_VIDEO_IDS]);
    expect(getTrainingGroup('hipaa').moduleIds).toEqual([HIPAA_TRAINING_ID]);
    expect(getTrainingGroup('ccpa').moduleIds).toEqual([...CCPA_TRAINING_VIDEO_IDS]);
    expect(CCPA_TRAINING_VIDEO_IDS).toEqual(['ccpa-1', 'ccpa-2']);
  });

  it('puts every module in exactly one group', () => {
    const allModules = TRAINING_GROUPS.flatMap((group) => [...group.moduleIds]);

    expect(new Set(allModules).size).toBe(allModules.length);
    for (const moduleId of allModules) {
      expect(groupForModule(moduleId)?.moduleIds).toContain(moduleId);
    }
  });

  it('gives every group at least one module to complete', () => {
    for (const group of TRAINING_GROUPS) {
      expect(group.moduleIds.length).toBeGreaterThan(0);
    }
  });

  it('renews every group yearly', () => {
    for (const group of TRAINING_GROUPS) {
      expect(group.cadenceDays).toBe(TRAINING_VALIDITY_DAYS);
    }
  });

  it('returns undefined for a module that is not in the catalog', () => {
    expect(groupForModule('nope')).toBeUndefined();
  });

  it('keeps the existing canonical id contract', () => {
    expect(isTrainingVideoId('sat-1')).toBe(true);
    expect(isTrainingVideoId('hipaa-sat-1')).toBe(true);
    expect(isTrainingVideoId('nope')).toBe(false);
  });
});

describe('requiredTrainingGroups', () => {
  const idsFor = (params: {
    securityTrainingStepEnabled: boolean;
    frameworkNames: readonly string[];
  }): string[] => requiredTrainingGroups(params).map((group) => group.id);

  it('requires nothing when the org toggle is off and no framework applies', () => {
    expect(idsFor({ securityTrainingStepEnabled: false, frameworkNames: ['SOC 2'] })).toEqual([]);
  });

  it('requires general training only when the org toggle is on', () => {
    expect(idsFor({ securityTrainingStepEnabled: true, frameworkNames: [] })).toEqual(['general']);
  });

  it('requires hipaa training when the org has the HIPAA framework', () => {
    expect(
      idsFor({ securityTrainingStepEnabled: false, frameworkNames: [HIPAA_FRAMEWORK_NAME] }),
    ).toEqual(['hipaa']);
  });

  it('requires ccpa training when the org has the CCPA framework', () => {
    expect(
      idsFor({ securityTrainingStepEnabled: false, frameworkNames: [CCPA_FRAMEWORK_NAME] }),
    ).toEqual(['ccpa']);
  });

  it('requires every applicable group together', () => {
    expect(
      idsFor({
        securityTrainingStepEnabled: true,
        frameworkNames: ['SOC 2', CCPA_FRAMEWORK_NAME, HIPAA_FRAMEWORK_NAME],
      }).sort(),
    ).toEqual(['ccpa', 'general', 'hipaa']);
  });
});

describe('framework instance filters', () => {
  it('keeps the HIPAA filter unchanged', () => {
    expect(hipaaFrameworkInstanceWhere('org_1')).toEqual({
      organizationId: 'org_1',
      framework: { name: 'HIPAA' },
    });
  });

  it('builds the CCPA filter the same way', () => {
    expect(ccpaFrameworkInstanceWhere('org_1')).toEqual({
      organizationId: 'org_1',
      framework: { name: 'CCPA' },
    });
  });
});
