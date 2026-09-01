// The DTO pulls the runtime `Departments` enum from @db, whose real module
// builds a Prisma client (and needs DATABASE_URL). Validation doesn't touch it.
jest.mock('@db', () => ({ Departments: { none: 'none' } }));

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePeopleDto } from './update-people.dto';

function validateUpdate(plain: Record<string, unknown>) {
  const dto = plainToInstance(UpdatePeopleDto, plain, {
    enableImplicitConversion: true,
  });
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('UpdatePeopleDto — primaryLocation', () => {
  it('accepts an ISO 3166-1 alpha-2 country code', async () => {
    expect(await validateUpdate({ primaryLocation: 'US' })).toHaveLength(0);
    expect(await validateUpdate({ primaryLocation: 'GB' })).toHaveLength(0);
    expect(await validateUpdate({ primaryLocation: 'BR' })).toHaveLength(0);
  });

  it('upper-cases and trims the code before validating', async () => {
    const dto = plainToInstance(UpdatePeopleDto, { primaryLocation: ' br ' });
    expect(dto.primaryLocation).toBe('BR');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts null to clear the location', async () => {
    expect(await validateUpdate({ primaryLocation: null })).toHaveLength(0);
  });

  it('rejects a country name or a non-ISO code', async () => {
    expect(
      await validateUpdate({ primaryLocation: 'Brazil' }),
    ).not.toHaveLength(0);
    expect(await validateUpdate({ primaryLocation: 'ZZ' })).not.toHaveLength(0);
    expect(await validateUpdate({ primaryLocation: '' })).not.toHaveLength(0);
  });
});

describe('UpdatePeopleDto — employmentType', () => {
  it('accepts the two employment types', async () => {
    expect(await validateUpdate({ employmentType: 'permanent' })).toHaveLength(
      0,
    );
    expect(
      await validateUpdate({
        employmentType: 'contract',
        contractExpiryDate: '2027-06-30T00:00:00.000Z',
      }),
    ).toHaveLength(0);
  });

  it('rejects an unknown employment type', async () => {
    expect(
      await validateUpdate({ employmentType: 'freelance' }),
    ).not.toHaveLength(0);
  });

  it('rejects an unparseable contract expiry date', async () => {
    expect(
      await validateUpdate({ contractExpiryDate: 'soon' }),
    ).not.toHaveLength(0);
  });
});
