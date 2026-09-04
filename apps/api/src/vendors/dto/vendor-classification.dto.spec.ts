import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';
import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  LEGACY_VENDOR_CATEGORIES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
} from '@trycompai/utils/vendors';
import { CreateVendorDto } from './create-vendor.dto';
import { UpdateVendorDto } from './update-vendor.dto';

/**
 * The classification contract — category plus the three dimension arrays — has to
 * hold on both the POST and the PATCH body, so both DTOs are driven through the
 * same cases here rather than the rules being asserted twice and drifting.
 */
interface ValidatedDto<T extends object> {
  dto: T;
  errors: Awaited<ReturnType<typeof validate>>;
}

/**
 * Mirrors the global ValidationPipe config from main.ts. Generic over the DTO
 * rather than taking a union of the two constructors: a union would leave
 * `plainToInstance` unable to pick between its single-object and array overloads.
 */
async function validateWith<T extends object>({
  Dto,
  plain,
}: {
  Dto: ClassConstructor<T>;
  plain: Record<string, unknown>;
}): Promise<ValidatedDto<T>> {
  const dto = plainToInstance(Dto, plain, { enableImplicitConversion: true });
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
}

const SUBJECTS = [
  {
    name: 'CreateVendorDto',
    // Required on create, and irrelevant to what these cases assert.
    check: (plain: Record<string, unknown>) =>
      validateWith({
        Dto: CreateVendorDto,
        plain: { name: 'Acme', description: 'Does things', ...plain },
      }),
  },
  {
    name: 'UpdateVendorDto',
    check: (plain: Record<string, unknown>) =>
      validateWith({ Dto: UpdateVendorDto, plain }),
  },
];

describe.each(SUBJECTS)('$name vendor classification', ({ check }) => {
  it('accepts every active category', async () => {
    for (const category of VENDOR_CATEGORIES) {
      expect((await check({ category })).errors).toHaveLength(0);
    }
  });

  /**
   * The retired values are still in the Postgres enum so a rolling deploy cannot
   * fail, which makes the DTO the only thing stopping one being written back.
   */
  it('rejects every retired category', async () => {
    for (const retired of LEGACY_VENDOR_CATEGORIES) {
      const { errors } = await check({ category: retired });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('category');
    }
  });

  it('rejects a category that is not in the vocabulary at all', async () => {
    const { errors } = await check({ category: 'invalid_category' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('category');
  });

  it('accepts every active value of each dimension', async () => {
    const dimensions = {
      deliveryModels: VENDOR_DELIVERY_MODELS,
      dataServiceTypes: DATA_SERVICE_TYPES,
      dataFlowRoles: DATA_FLOW_ROLES,
    };
    for (const [field, values] of Object.entries(dimensions)) {
      for (const value of values) {
        expect((await check({ [field]: [value] })).errors).toHaveLength(0);
      }
    }
  });

  it('round-trips a data vendor with several types and roles', async () => {
    const plain = {
      category: 'data_enrichment',
      deliveryModels: ['saas', 'api_service'],
      dataServiceTypes: ['company_data', 'enrichment', 'verification'],
      dataFlowRoles: ['processor', 'source'],
    };

    const { dto, errors } = await check(plain);

    expect(errors).toHaveLength(0);
    expect(dto.deliveryModels).toEqual(plain.deliveryModels);
    expect(dto.dataServiceTypes).toEqual(plain.dataServiceTypes);
    expect(dto.dataFlowRoles).toEqual(plain.dataFlowRoles);
  });

  // The ordinary case: most vendors deal in no data of their own.
  it('accepts empty data dimensions', async () => {
    const { errors } = await check({
      category: 'sales',
      deliveryModels: ['saas'],
      dataServiceTypes: [],
      dataFlowRoles: [],
    });
    expect(errors).toHaveLength(0);
  });

  // The dimensions are additive, so an existing client that has never heard of
  // them must keep working.
  it('accepts a body that omits the dimensions entirely', async () => {
    expect((await check({ category: 'legal' })).errors).toHaveLength(0);
  });

  it('rejects an unknown value inside a dimension', async () => {
    const { errors } = await check({
      deliveryModels: ['saas', 'carrier_pigeon'],
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('deliveryModels');
  });

  it('rejects a dimension sent as a bare string', async () => {
    const { errors } = await check({ dataFlowRoles: 'source' });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].property).toBe('dataFlowRoles');
  });
});
