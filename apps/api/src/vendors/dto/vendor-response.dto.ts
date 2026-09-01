import { ApiProperty } from '@nestjs/swagger';
import {
  VendorContractTerm,
  VendorCostModel,
  VendorStatus,
  Likelihood,
  Impact,
} from '@db';
import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
  type DataFlowRoleValue,
  type DataServiceTypeValue,
  type VendorCategoryValue,
  type VendorDeliveryModelValue,
} from '@trycompai/utils/vendors';

export class VendorResponseDto {
  @ApiProperty({
    description: 'Vendor ID',
    example: 'vnd_abc123def456',
  })
  id: string;

  @ApiProperty({
    description: 'Vendor name',
    example: 'CloudTech Solutions Inc.',
  })
  name: string;

  @ApiProperty({
    description: 'Detailed description of the vendor and services provided',
    example:
      'Cloud infrastructure provider offering AWS-like services including compute, storage, and networking solutions for enterprise customers.',
  })
  description: string;

  @ApiProperty({
    description:
      'What the vendor does for us. Exactly one functional category — never a delivery ' +
      'method: a hosted CRM is `sales`, not "SaaS".',
    enum: VENDOR_CATEGORIES,
    example: 'cloud_infrastructure',
  })
  category: VendorCategoryValue;

  // Non-optional: the columns are non-null lists, so a vendor that was never classified
  // along a dimension comes back as [] rather than absent.
  @ApiProperty({
    description:
      'How we consume the vendor. Independent of what it does, and the signal that ' +
      'decides whether the workload runs outside our perimeter.',
    enum: VENDOR_DELIVERY_MODELS,
    isArray: true,
    example: ['saas'],
  })
  deliveryModels: VendorDeliveryModelValue[];

  @ApiProperty({
    description:
      'What data the vendor deals in, for vendors whose product is data. Empty for a ' +
      'vendor that merely stores data we type into it.',
    enum: DATA_SERVICE_TYPES,
    isArray: true,
    example: ['company_data', 'enrichment'],
  })
  dataServiceTypes: DataServiceTypeValue[];

  @ApiProperty({
    description:
      'Where the vendor sits in our data flow. Empty when no meaningful data crosses ' +
      'the boundary; a vendor may hold several roles at once.',
    enum: DATA_FLOW_ROLES,
    isArray: true,
    example: ['processor', 'source'],
  })
  dataFlowRoles: DataFlowRoleValue[];

  @ApiProperty({
    description: 'Assessment status of the vendor',
    enum: VendorStatus,
    example: VendorStatus.not_assessed,
  })
  status: VendorStatus;

  @ApiProperty({
    description: 'Inherent probability of risk before controls',
    enum: Likelihood,
    example: Likelihood.possible,
  })
  inherentProbability: Likelihood;

  @ApiProperty({
    description: 'Inherent impact of risk before controls',
    enum: Impact,
    example: Impact.moderate,
  })
  inherentImpact: Impact;

  @ApiProperty({
    description: 'Residual probability after controls are applied',
    enum: Likelihood,
    example: Likelihood.unlikely,
  })
  residualProbability: Likelihood;

  @ApiProperty({
    description: 'Residual impact after controls are applied',
    enum: Impact,
    example: Impact.minor,
  })
  residualImpact: Impact;

  @ApiProperty({
    description: 'Vendor website URL',
    nullable: true,
    example: 'https://www.cloudtechsolutions.com',
  })
  website: string | null;

  @ApiProperty({
    description: 'Whether the vendor is a sub-processor',
    example: false,
  })
  isSubProcessor: boolean;

  @ApiProperty({
    description: 'Organization ID',
    example: 'org_abc123def456',
  })
  organizationId: string;

  @ApiProperty({
    description: 'ID of the user assigned to manage this vendor',
    nullable: true,
    example: 'mem_abc123def456',
  })
  assigneeId: string | null;

  @ApiProperty({
    description: 'Seats included in the contract',
    type: Number,
    nullable: true,
    example: 50,
  })
  totalSeats: number | null;

  @ApiProperty({
    description: 'Seats currently in use',
    type: Number,
    nullable: true,
    example: 42,
  })
  usedSeats: number | null;

  @ApiProperty({
    description: 'Date the contract renews',
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2027-01-31T00:00:00.000Z',
  })
  renewalDate: Date | null;

  @ApiProperty({
    description:
      'Cost in USD cents for one billing period, as given by contractTerm',
    type: Number,
    nullable: true,
    example: 50000,
  })
  costCents: number | null;

  @ApiProperty({
    description:
      'How the vendor charges: a flat fee, per seat, by usage, or a mix',
    enum: VendorCostModel,
    nullable: true,
    example: VendorCostModel.per_seat,
  })
  costModel: VendorCostModel | null;

  @ApiProperty({
    description: 'Whether the contract is billed monthly or yearly',
    enum: VendorContractTerm,
    nullable: true,
    example: VendorContractTerm.yearly,
  })
  contractTerm: VendorContractTerm | null;

  @ApiProperty({
    description: 'Days of notice required before cancellation',
    type: Number,
    nullable: true,
    example: 30,
  })
  noticePeriodDays: number | null;

  @ApiProperty({
    description:
      'Member ID of the internal person in charge of running this system day to day. Distinct from assigneeId, the IT or compliance member running the risk assessment.',
    type: String,
    nullable: true,
    example: 'mem_abc123def456',
  })
  ownerId: string | null;

  @ApiProperty({
    description: 'When the vendor was created',
    type: String,
    format: 'date-time',
    example: '2024-01-15T10:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'When the vendor was last updated',
    type: String,
    format: 'date-time',
    example: '2024-01-16T14:45:00Z',
  })
  updatedAt: Date;
}
