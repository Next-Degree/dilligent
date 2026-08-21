import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateVendorDto } from './update-vendor.dto';

function validateContractFields(plain: Record<string, unknown>) {
  const dto = plainToInstance(UpdateVendorDto, plain, {
    enableImplicitConversion: true,
  });
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('vendor contract fields', () => {
  it('accepts a fully populated contract', async () => {
    const errors = await validateContractFields({
      totalSeats: 50,
      usedSeats: 42,
      renewalDate: '2027-01-31T00:00:00.000Z',
      costCents: 50_000,
      costModel: 'per_seat',
      contractTerm: 'yearly',
      noticePeriodDays: 30,
      ownerId: 'mem_abc123',
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts null for every contract field', async () => {
    const errors = await validateContractFields({
      totalSeats: null,
      usedSeats: null,
      renewalDate: null,
      costCents: null,
      costModel: null,
      contractTerm: null,
      noticePeriodDays: null,
      ownerId: null,
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts zero seats and zero cost', async () => {
    const errors = await validateContractFields({
      totalSeats: 0,
      usedSeats: 0,
      costCents: 0,
      noticePeriodDays: 0,
    });
    expect(errors).toHaveLength(0);
  });

  it.each(['monthly', 'yearly'])('accepts contractTerm %s', async (term) => {
    const errors = await validateContractFields({ contractTerm: term });
    expect(errors).toHaveLength(0);
  });

  it.each(['fixed', 'per_seat', 'usage_based', 'mixed'])(
    'accepts costModel %s',
    async (costModel) => {
      const errors = await validateContractFields({ costModel });
      expect(errors).toHaveLength(0);
    },
  );

  it('rejects an unknown costModel', async () => {
    const errors = await validateContractFields({ costModel: 'per_gigabyte' });
    expect(errors.map((e) => e.property)).toContain('costModel');
  });

  it('rejects an unknown contractTerm', async () => {
    const errors = await validateContractFields({ contractTerm: 'quarterly' });
    expect(errors.map((e) => e.property)).toContain('contractTerm');
  });

  it.each([
    ['negative seats', { totalSeats: -1 }, 'totalSeats'],
    ['fractional seats', { usedSeats: 1.5 }, 'usedSeats'],
    ['a negative cost', { costCents: -100 }, 'costCents'],
    ['a negative notice period', { noticePeriodDays: -1 }, 'noticePeriodDays'],
    [
      'a malformed renewal date',
      { renewalDate: 'next tuesday' },
      'renewalDate',
    ],
  ])('rejects %s', async (_label, payload, property) => {
    const errors = await validateContractFields(payload);
    expect(errors.map((e) => e.property)).toContain(property);
  });

  it.each([
    ['seats', { totalSeats: 10_000_001 }, 'totalSeats'],
    ['cost', { costCents: 2_000_000_001 }, 'costCents'],
    ['notice period', { noticePeriodDays: 3651 }, 'noticePeriodDays'],
  ])('rejects out-of-range %s', async (_label, payload, property) => {
    const errors = await validateContractFields(payload);
    expect(errors.map((e) => e.property)).toContain(property);
  });

  it('leaves the fields untouched when they are omitted', async () => {
    const dto = plainToInstance(
      UpdateVendorDto,
      { name: 'Acronis' },
      { enableImplicitConversion: true },
    );
    expect(dto.totalSeats).toBeUndefined();
    expect(dto.renewalDate).toBeUndefined();
    expect(dto.ownerId).toBeUndefined();
    expect(await validate(dto, { whitelist: true })).toHaveLength(0);
  });
});
