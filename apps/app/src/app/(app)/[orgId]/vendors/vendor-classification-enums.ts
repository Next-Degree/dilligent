import {
  DATA_FLOW_ROLES,
  DATA_SERVICE_TYPES,
  VENDOR_CATEGORIES,
  VENDOR_DELIVERY_MODELS,
} from '@trycompai/utils/vendors';
import { z } from 'zod';

/**
 * The zod vocabulary shared by the create form schema and the vendor server
 * action schemas.
 *
 * `Object.values(VendorCategory)` still yields the four retired categories (they
 * stay in the Postgres enum for rolling-deploy safety), so validation is pinned
 * to the active vocabulary from `@trycompai/utils/vendors` instead. Each list is
 * spread into a mutable tuple because `z.enum` wants a writable array.
 *
 * These live here rather than in `@trycompai/utils` because that package has no
 * zod dependency.
 */

/**
 * Callers differ only in whether they want a custom "nothing picked" message, so
 * the category enum is a factory rather than a const.
 */
export const activeVendorCategoryEnum = (params?: { error: string }) =>
  z.enum([...VENDOR_CATEGORIES], params);

export const vendorDeliveryModelEnum = z.enum([...VENDOR_DELIVERY_MODELS]);
export const dataServiceTypeEnum = z.enum([...DATA_SERVICE_TYPES]);
export const dataFlowRoleEnum = z.enum([...DATA_FLOW_ROLES]);
