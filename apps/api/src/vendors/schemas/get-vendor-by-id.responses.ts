import type { ApiResponseOptions } from '@nestjs/swagger';

export const GET_VENDOR_BY_ID_RESPONSES: Record<number, ApiResponseOptions> = {
  200: {
    status: 200,
    description: 'Vendor retrieved successfully',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Vendor ID',
              example: 'vnd_abc123def456',
            },
            name: {
              type: 'string',
              description: 'Vendor name',
              example: 'CloudTech Solutions Inc.',
            },
            description: {
              type: 'string',
              description: 'Vendor description',
              example:
                'Cloud infrastructure provider offering AWS-like services including compute, storage, and networking solutions for enterprise customers.',
            },
            category: {
              type: 'string',
              enum: [
                'cloud',
                'infrastructure',
                'software_as_a_service',
                'finance',
                'marketing',
                'sales',
                'hr',
                'other',
              ],
              example: 'cloud',
            },
            status: {
              type: 'string',
              enum: ['not_assessed', 'in_progress', 'assessed'],
              example: 'not_assessed',
            },
            inherentProbability: {
              type: 'string',
              enum: [
                'very_unlikely',
                'unlikely',
                'possible',
                'likely',
                'very_likely',
              ],
              example: 'possible',
            },
            inherentImpact: {
              type: 'string',
              enum: ['insignificant', 'minor', 'moderate', 'major', 'severe'],
              example: 'moderate',
            },
            residualProbability: {
              type: 'string',
              enum: [
                'very_unlikely',
                'unlikely',
                'possible',
                'likely',
                'very_likely',
              ],
              example: 'unlikely',
            },
            residualImpact: {
              type: 'string',
              enum: ['insignificant', 'minor', 'moderate', 'major', 'severe'],
              example: 'minor',
            },
            website: {
              type: 'string',
              nullable: true,
              example: 'https://www.cloudtechsolutions.com',
            },
            organizationId: {
              type: 'string',
              example: 'org_abc123def456',
            },
            assigneeId: {
              type: 'string',
              nullable: true,
              description: 'ID of the user assigned to manage this vendor',
              example: 'mem_abc123def456',
            },
            totalSeats: {
              type: 'integer',
              nullable: true,
              description: 'Seats included in the contract',
              example: 50,
            },
            usedSeats: {
              type: 'integer',
              nullable: true,
              description: 'Seats currently in use',
              example: 42,
            },
            renewalDate: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'Date the contract renews',
            },
            annualCostCents: {
              type: 'integer',
              nullable: true,
              description: 'Annual contract cost in USD cents',
              example: 1200000,
            },
            contractTerm: {
              type: 'string',
              nullable: true,
              enum: ['monthly', 'yearly'],
              description: 'Whether the contract is billed monthly or yearly',
              example: 'yearly',
            },
            noticePeriodDays: {
              type: 'integer',
              nullable: true,
              description: 'Days of notice required before cancellation',
              example: 30,
            },
            ownerId: {
              type: 'string',
              nullable: true,
              description: 'Member ID of the business owner of this contract',
              example: 'mem_abc123def456',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'When the vendor was created',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'When the vendor was last updated',
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
  401: {
    status: 401,
    description:
      'Unauthorized - Invalid authentication or insufficient permissions',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              example: 'Invalid or expired API key',
            },
          },
        },
      },
    },
  },
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
              example:
                'Vendor with ID vnd_abc123def456 not found in organization org_abc123def456',
            },
          },
        },
      },
    },
  },
  500: {
    status: 500,
    description: 'Internal server error',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              example: 'Internal server error',
            },
          },
        },
      },
    },
  },
};
