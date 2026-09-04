import { db } from '@db/server';
import { Card, CardContent, CardHeader, CardTitle } from '@trycompai/ui/card';
import {
  VENDOR_CATEGORIES,
  migrateLegacyVendorCategory,
  vendorCategoryLabel,
} from '@trycompai/utils/vendors';
import { VendorCategoryChart } from './category-chart';

/**
 * How many empty categories to pad the chart with when the org has barely any
 * vendors. The vocabulary went from 8 values to 19, so the old "show up to 2
 * zero-value categories whenever fewer than 4 have values" rule would now draw a
 * wall of empty bars. Non-zero categories are the chart; a couple of zeros are
 * only there so a brand-new org sees axes rather than a blank card.
 */
const EMPTY_CATEGORY_PADDING = 2;

/**
 * With 19 categories, a chart that renders every one is unreadable. Show the
 * biggest slice of real data and roll the tail into a single "Other categories"
 * bar so the total still adds up.
 */
const MAX_CATEGORIES_SHOWN = 8;

/**
 * Below this many non-empty categories the chart gets its padding bars — one or two
 * real bars alone read as a rendering bug rather than as an empty vendor register.
 */
const PAD_BELOW_CATEGORY_COUNT = 3;

interface Props {
  organizationId: string;
}

export async function VendorsByCategory({ organizationId }: Props) {
  const vendors = await getVendorsByCategory(organizationId);

  // Counts keyed by the active vocabulary only. `Object.values(VendorCategory)`
  // would reintroduce the four retired values, which no longer belong on a chart.
  const counts = new Map<string, number>();
  for (const row of vendors) {
    // A row the backfill has not reached yet still holds a retired value; fold it
    // into the functional category it maps to instead of dropping it.
    const { category } = migrateLegacyVendorCategory(row.category ?? 'other');
    counts.set(category, (counts.get(category) ?? 0) + row._count);
  }

  const data = VENDOR_CATEGORIES.map((category) => ({
    name: vendorCategoryLabel(category),
    value: counts.get(category) ?? 0,
  })).sort((a, b) => b.value - a.value);

  // No special case for an org with zero classified vendors: `buildTopCategories`
  // already returns just the padding when nothing has a value.
  const categoriesToShow = buildTopCategories(data);

  return (
    <Card className="h-full w-full">
      <CardHeader>
        <CardTitle>{'Vendors by Category'}</CardTitle>
      </CardHeader>
      <CardContent className="w-full">
        <VendorCategoryChart data={categoriesToShow} showEmptyDepartments={true} />
      </CardContent>
    </Card>
  );
}

interface CategoryCount {
  name: string;
  value: number;
}

/** `data` must be sorted by descending value, so the empty categories are its tail. */
function buildTopCategories(data: CategoryCount[]) {
  const withValues = data.filter((category) => category.value > 0);

  if (withValues.length <= MAX_CATEGORIES_SHOWN) {
    // Pad a nearly-empty chart so it doesn't render as one lonely bar.
    const padding =
      withValues.length < PAD_BELOW_CATEGORY_COUNT
        ? data.slice(withValues.length, withValues.length + EMPTY_CATEGORY_PADDING)
        : [];
    return [...withValues, ...padding];
  }

  const top = withValues.slice(0, MAX_CATEGORIES_SHOWN - 1);
  const remainder = withValues.slice(MAX_CATEGORIES_SHOWN - 1);
  const remainderTotal = remainder.reduce((sum, category) => sum + category.value, 0);

  return [...top, { name: `Other categories (${remainder.length})`, value: remainderTotal }];
}

const getVendorsByCategory = async (organizationId: string) => {
  const vendorsByCategory = await db.vendor.groupBy({
    by: ['category'],
    where: { organizationId },
    _count: true,
  });

  return vendorsByCategory;
};
