import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional } from 'class-validator';
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
import {
  VENDOR_CLASSIFICATION_DESCRIPTIONS,
  VENDOR_CLASSIFICATION_EXAMPLES,
} from '../schemas/vendor-classification.schema';

/**
 * The four classification dimensions, shared by every request body that writes a
 * vendor — create, update, the admin equivalents and discovery approval. They were
 * copy-pasted into each of those, which is how three of them ended up advertising a
 * vocabulary the fourth had already retired.
 *
 * Every dimension is validated against the ACTIVE vocabulary rather than the Prisma
 * enum: the Postgres type still carries retired values so a rolling deploy cannot
 * fail, which leaves these decorators as the only thing stopping a stale client from
 * writing one back.
 */
export class VendorClassificationFieldsDto {
  @ApiPropertyOptional({
    description: VENDOR_CLASSIFICATION_DESCRIPTIONS.category,
    enum: VENDOR_CATEGORIES,
    example: VENDOR_CLASSIFICATION_EXAMPLES.category,
  })
  @IsOptional()
  @IsIn([...VENDOR_CATEGORIES])
  category?: VendorCategoryValue;

  @ApiPropertyOptional({
    description: VENDOR_CLASSIFICATION_DESCRIPTIONS.deliveryModels,
    enum: VENDOR_DELIVERY_MODELS,
    isArray: true,
    example: [...VENDOR_CLASSIFICATION_EXAMPLES.deliveryModels],
  })
  @IsOptional()
  @IsArray()
  @IsIn([...VENDOR_DELIVERY_MODELS], { each: true })
  deliveryModels?: VendorDeliveryModelValue[];

  @ApiPropertyOptional({
    description: VENDOR_CLASSIFICATION_DESCRIPTIONS.dataServiceTypes,
    enum: DATA_SERVICE_TYPES,
    isArray: true,
    example: [...VENDOR_CLASSIFICATION_EXAMPLES.dataServiceTypes],
  })
  @IsOptional()
  @IsArray()
  @IsIn([...DATA_SERVICE_TYPES], { each: true })
  dataServiceTypes?: DataServiceTypeValue[];

  @ApiPropertyOptional({
    description: VENDOR_CLASSIFICATION_DESCRIPTIONS.dataFlowRoles,
    enum: DATA_FLOW_ROLES,
    isArray: true,
    example: [...VENDOR_CLASSIFICATION_EXAMPLES.dataFlowRoles],
  })
  @IsOptional()
  @IsArray()
  @IsIn([...DATA_FLOW_ROLES], { each: true })
  dataFlowRoles?: DataFlowRoleValue[];
}
