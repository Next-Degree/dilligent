import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The hosted MCP server is built from the committed OpenAPI spec (gram.json
// pushes packages/docs/openapi.json as is), so whether an endpoint becomes an
// MCP tool is decided by what that file says, not by the Speakeasy overlay.
const spec = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../packages/docs/openapi.json'),
    'utf8',
  ),
);

describe('CCPA training endpoints are not offered over MCP', () => {
  it.each([
    '/v1/training/send-ccpa-completion-email',
    '/v1/training/generate-ccpa-certificate',
  ])('%s is disabled for MCP in the published spec', (path) => {
    expect(spec.paths[path]?.post?.['x-speakeasy-mcp']).toMatchObject({
      disabled: true,
    });
  });
});
