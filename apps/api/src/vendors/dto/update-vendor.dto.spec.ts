import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  LEGACY_VENDOR_CATEGORIES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
} from '@trycompai/utils/vendors';
import { UpdateVendorDto } from './update-vendor.dto';

/**
 * Mirrors the global ValidationPipe config from main.ts:
 *   whitelist: true, transform: true, enableImplicitConversion: true
 */
function toDto(plain: Record<string, unknown>): UpdateVendorDto {
  return plainToInstance(UpdateVendorDto, plain, {
    enableImplicitConversion: true,
  });
}

describe('UpdateVendorDto', () => {
  it('should accept a valid full update payload', async () => {
    const dto = toDto({
      name: 'Acronis',
      description: 'Backup solutions provider',
      category: 'collaboration_productivity',
      status: 'assessed',
      website: 'https://www.acronis.com',
      isSubProcessor: false,
      assigneeId: 'mem_abc123',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('should accept a minimal update (single field)', async () => {
    const dto = toDto({ website: 'https://www.acronis.com' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('should accept an empty body (no fields to update)', async () => {
    const dto = toDto({});
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  // ── The bug this DTO fix addresses ────────────────────────────────
  it('should accept empty description (vendors from onboarding)', async () => {
    const dto = toDto({
      name: 'Acronis',
      description: '',
      category: 'collaboration_productivity',
      status: 'assessed',
      website: 'https://www.acronis.com',
      isSubProcessor: false,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('should still reject empty name', async () => {
    const dto = toDto({ name: '' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('name');
  });

  // ── assigneeId: null (unassigned vendor) ──────────────────────────
  it('should accept assigneeId: null', async () => {
    const dto = toDto({ assigneeId: null });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  // ── website handling ──────────────────────────────────────────────
  it('should transform empty website to undefined (skip validation)', async () => {
    const dto = toDto({ website: '' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
    expect(dto.website).toBeUndefined();
  });

  it('should accept a valid website URL', async () => {
    const dto = toDto({ website: 'https://www.cloudflare.com' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('should reject an invalid website URL', async () => {
    const dto = toDto({ website: 'not-a-url' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('website');
  });

  // ── enum validation ───────────────────────────────────────────────
  it('should reject invalid category enum', async () => {
    const dto = toDto({ category: 'invalid_category' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('category');
  });

  // The point of validating against the active set rather than the Prisma enum:
  // Postgres still knows these values, so only the DTO stops them coming back.
  it('should reject retired category values still present in the DB enum', async () => {
    for (const retired of LEGACY_VENDOR_CATEGORIES) {
      const dto = toDto({ category: retired });
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('category');
    }
  });

  it('should accept every active category value', async () => {
    for (const category of VENDOR_CATEGORIES) {
      const dto = toDto({ category });
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors).toHaveLength(0);
    }
  });

  // ── classification dimensions ─────────────────────────────────────
  it('should accept multiple data service types and data flow roles', async () => {
    const dto = toDto({
      category: 'data_enrichment',
      deliveryModels: ['saas', 'api_service'],
      dataServiceTypes: ['company_data', 'enrichment', 'verification'],
      dataFlowRoles: ['processor', 'source'],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
    expect(dto.dataServiceTypes).toEqual([
      'company_data',
      'enrichment',
      'verification',
    ]);
    expect(dto.dataFlowRoles).toEqual(['processor', 'source']);
  });

  // The common case: most vendors deal in no data of their own.
  it('should accept empty dataServiceTypes and dataFlowRoles', async () => {
    const dto = toDto({
      category: 'sales',
      deliveryModels: ['saas'],
      dataServiceTypes: [],
      dataFlowRoles: [],
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
  });

  it('should accept every active value of each classification dimension', async () => {
    const dimensions = {
      deliveryModels: VENDOR_DELIVERY_MODELS,
      dataServiceTypes: DATA_SERVICE_TYPES,
      dataFlowRoles: DATA_FLOW_ROLES,
    };
    for (const [field, values] of Object.entries(dimensions)) {
      for (const value of values) {
        const dto = toDto({ [field]: [value] });
        const errors = await validate(dto, {
          whitelist: true,
          forbidNonWhitelisted: true,
        });
        expect(errors).toHaveLength(0);
      }
    }
  });

  it('should reject an unknown value inside a classification array', async () => {
    const dto = toDto({ dataFlowRoles: ['source', 'sink'] });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('dataFlowRoles');
  });

  it('should reject a classification dimension that is not an array', async () => {
    const dto = toDto({ deliveryModels: 'saas' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('deliveryModels');
  });

  it('should reject invalid status enum', async () => {
    const dto = toDto({ status: 'invalid_status' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('status');
  });

  // ── treatment strategy fields (ENG-221) ───────────────────────────
  it('should accept valid treatmentStrategy enum values', async () => {
    for (const strategy of ['accept', 'avoid', 'mitigate', 'transfer']) {
      const dto = toDto({ treatmentStrategy: strategy });
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      expect(errors).toHaveLength(0);
    }
  });

  it('should reject invalid treatmentStrategy enum value', async () => {
    const dto = toDto({ treatmentStrategy: 'ignore' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('treatmentStrategy');
  });

  it('should accept treatmentStrategyDescription as a string', async () => {
    const dto = toDto({
      treatmentStrategy: 'mitigate',
      treatmentStrategyDescription:
        'We isolated the vendor to a dedicated VPC.',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors).toHaveLength(0);
    expect(dto.treatmentStrategyDescription).toBe(
      'We isolated the vendor to a dedicated VPC.',
    );
  });

  it('should reject treatmentStrategyDescription longer than 20,000 chars', async () => {
    const dto = toDto({
      treatmentStrategyDescription: 'x'.repeat(20_001),
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('treatmentStrategyDescription');
  });

  // ── forbidNonWhitelisted ──────────────────────────────────────────
  it('should reject unknown properties', async () => {
    const dto = toDto({ name: 'Acronis', unknownField: 'value' });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'unknownField')).toBe(true);
  });
});
