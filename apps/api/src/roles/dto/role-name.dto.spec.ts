import { plainToInstance } from 'class-transformer';
import { CreateRoleDto } from './create-role.dto';
import { UpdateRoleDto } from './update-role.dto';

// member.role is always parsed with trimmed names, so a stored trailing
// space would make the role impossible to match. Names are trimmed on save.
describe('role name trimming', () => {
  it.each([
    ['CreateRoleDto', CreateRoleDto],
    ['UpdateRoleDto', UpdateRoleDto],
  ])('%s trims the role name', (_label, Dto) => {
    const dto = plainToInstance(Dto, { name: '  Compliance Lead ' });

    expect(dto.name).toBe('Compliance Lead');
  });
});
