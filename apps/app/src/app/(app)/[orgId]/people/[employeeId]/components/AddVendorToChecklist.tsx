'use client';

import { useVendors } from '@/hooks/use-vendors';
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@trycompai/design-system';
import { useMemo, useState } from 'react';

interface AddVendorToChecklistProps {
  /** Vendor ids already on the checklist, which must not be offered again. */
  listedVendorIds: string[];
  onAdd: (vendorId: string) => Promise<void>;
  disabled?: boolean;
}

/**
 * Adds a vendor the scoped checklist did not include.
 *
 * Observed access only covers apps signed into with a work Google account, so anything
 * signed up for with a password or a personal address is invisible to it. Without this the
 * scoping would be a dead end for exactly those cases — the reviewer would know about
 * access the checklist refuses to let them record.
 */
export function AddVendorToChecklist({
  listedVendorIds,
  onAdd,
  disabled = false,
}: AddVendorToChecklistProps) {
  const { data: vendorsResponse } = useVendors();
  const [selectedId, setSelectedId] = useState<string>('');
  const [isAdding, setIsAdding] = useState(false);

  const available = useMemo(() => {
    const vendors = vendorsResponse?.data?.data;
    if (!Array.isArray(vendors)) return [];
    const listed = new Set(listedVendorIds);
    return vendors
      .filter((vendor: { id: string }) => !listed.has(vendor.id))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
  }, [vendorsResponse, listedVendorIds]);

  if (available.length === 0) {
    return null;
  }

  const handleAdd = async () => {
    if (!selectedId) return;
    setIsAdding(true);
    try {
      await onAdd(selectedId);
      setSelectedId('');
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t py-3 pl-11 pr-3.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 sm:max-w-xs">
        <Select
          value={selectedId}
          onValueChange={(value) => setSelectedId(value ?? '')}
          disabled={disabled || isAdding}
        >
          <SelectTrigger>
            <SelectValue placeholder="Add another vendor…" />
          </SelectTrigger>
          <SelectContent>
            {available.map((vendor: { id: string; name: string }) => (
              <SelectItem key={vendor.id} value={vendor.id}>
                {vendor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={handleAdd}
          disabled={!selectedId || disabled || isAdding}
        >
          {isAdding ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </div>
  );
}
