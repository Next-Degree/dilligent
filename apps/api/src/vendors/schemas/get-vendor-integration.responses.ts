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

export const GET_VENDOR_INTEGRATION_RESPONSES: Record<
  number,
  ApiResponseOptions
> = {
  200: {
    status: 200,
    description:
      "The vendor's integration, its checks, and the people its access checks report. Checks and users are empty unless the integration is connected.",
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            vendorId: { type: 'string', example: 'vnd_abc123def456' },
            integration: {
              type: 'object',
              nullable: true,
              description: 'Null when no integration identifies this vendor',
              properties: {
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
            checks: {
              type: 'array',
              description: "The integration's checks, with their latest run",
              items: {
                type: 'object',
                properties: {
                  checkId: {
                    type: 'string',
                    example: 'github_employee_access',
                  },
                  name: { type: 'string', example: 'Employee Access' },
                  description: { type: 'string' },
                  taskMapping: {
                    type: 'string',
                    nullable: true,
                    example: 'access-control',
                  },
                  lastRun: {
                    type: 'object',
                    nullable: true,
                    description: 'Null when the check has never really run',
                    properties: {
                      runId: { type: 'string', example: 'icr_abc123' },
                      status: { type: 'string', example: 'completed' },
                      startedAt: {
                        type: 'string',
                        format: 'date-time',
                        nullable: true,
                      },
                      completedAt: {
                        type: 'string',
                        format: 'date-time',
                        nullable: true,
                      },
                      totalChecked: { type: 'number', example: 12 },
                      passedCount: { type: 'number', example: 11 },
                      failedCount: { type: 'number', example: 1 },
                      errorMessage: { type: 'string', nullable: true },
                    },
                  },
                },
              },
            },
            users: {
              type: 'array',
              description:
                "The people the integration's access checks report, joined to organization members",
              items: {
                type: 'object',
                properties: {
                  resourceId: {
                    type: 'string',
                    description: 'The identity the check reported',
                    example: 'ada@acme.com',
                  },
                  email: { type: 'string', nullable: true },
                  name: { type: 'string', nullable: true },
                  role: { type: 'string', nullable: true, example: 'admin' },
                  isAdmin: { type: 'boolean', nullable: true },
                  status: { type: 'string', nullable: true },
                  lastLogin: { type: 'string', nullable: true },
                  passed: {
                    type: 'boolean',
                    description: 'False when any reporting check flagged them',
                  },
                  collectedAt: { type: 'string', format: 'date-time' },
                  checks: {
                    type: 'array',
                    description: 'The checks that reported this person',
                    items: {
                      type: 'object',
                      properties: {
                        checkId: { type: 'string' },
                        checkName: { type: 'string' },
                      },
                    },
                  },
                  member: {
                    type: 'object',
                    nullable: true,
                    description:
                      'The organization member this account resolves to; null when it belongs to nobody in the organization',
                    properties: {
                      id: { type: 'string', example: 'mem_abc123def456' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                      image: { type: 'string', nullable: true },
                      deactivated: { type: 'boolean' },
                    },
                  },
                },
              },
            },
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
  404: {
    status: 404,
    description: 'Vendor not found',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              example: 'Vendor with ID vnd_abc123def456 not found',
            },
          },
        },
      },
    },
  },
  500: SERVER_ERROR,
};
