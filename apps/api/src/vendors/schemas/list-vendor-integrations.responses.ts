import type { ApiResponseOptions } from '@nestjs/swagger';
const UNAUTHORIZED: ApiResponseOptions = {
  status: 401,
  description:
    'Unauthorized - Invalid authentication or insufficient permissions',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Invalid or expired API key' },
        },
      },
    },
  },
};

const SERVER_ERROR: ApiResponseOptions = {
  status: 500,
  description: 'Internal server error',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Internal server error' },
        },
      },
    },
  },
};

export const LIST_VENDOR_INTEGRATIONS_RESPONSES: Record<
  number,
  ApiResponseOptions
> = {
  200: {
    status: 200,
    description:
      'The integration each vendor resolves to. Vendors that match no integration are omitted.',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  vendorId: { type: 'string', example: 'vnd_abc123def456' },
                  slug: {
                    type: 'string',
                    description: 'The integration the vendor resolves to',
                    example: 'github',
                  },
                  name: { type: 'string', example: 'GitHub' },
                  logoUrl: { type: 'string', nullable: true },
                  connected: {
                    type: 'boolean',
                    description:
                      'Whether the organization has an active connection. Checks and users are only reported for connected integrations.',
                    example: true,
                  },
                  connectionId: {
                    type: 'string',
                    nullable: true,
                    example: 'icn_abc123',
                  },
                  lastSyncAt: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                  },
                  nextSyncAt: {
                    type: 'string',
                    format: 'date-time',
                    nullable: true,
                  },
                  category: {
                    type: 'string',
                    description: "The integration's catalog category",
                    example: 'Development',
                  },
                  matchedOn: {
                    type: 'string',
                    enum: ['slug', 'name', 'alias', 'domain'],
                    description:
                      'Which identity rule linked this vendor to the integration',
                    example: 'name',
                  },
                },
              },
            },
            count: { type: 'number', example: 3 },
            authType: {
              type: 'string',
              enum: ['api-key', 'session'],
              description: 'How the request was authenticated',
            },
            authenticatedUser: {
              type: 'object',
              description: 'User information (only for session auth)',
              properties: {
                id: { type: 'string', example: 'usr_def456ghi789' },
                email: { type: 'string', example: 'user@example.com' },
              },
            },
          },
        },
      },
    },
  },
  401: UNAUTHORIZED,
  500: SERVER_ERROR,
};
