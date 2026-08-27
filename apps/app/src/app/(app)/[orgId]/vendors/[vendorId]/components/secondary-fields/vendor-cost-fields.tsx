'use client';

import { VendorContractTerm, VendorCostModel } from '@db';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@trycompai/design-system';
import { Controller, useWatch, type Control, type FieldErrors } from 'react-hook-form';
import type { z } from 'zod';
import type { updateVendorSchema } from '../../actions/schema';
import { costUnitLabel, parseNumberInput, toInputValue } from './contract-format';

type VendorFormValues = z.infer<typeof updateVendorSchema>;

const NOT_SET = 'not_set';

const COST_MODEL_LABELS: Record<VendorCostModel, string> = {
  [VendorCostModel.fixed]: 'Fixed fee',
  [VendorCostModel.per_seat]: 'Per seat',
  [VendorCostModel.usage_based]: 'Usage based',
  [VendorCostModel.mixed]: 'Mixed',
};

const CONTRACT_TERM_LABELS: Record<VendorContractTerm, string> = {
  [VendorContractTerm.monthly]: 'Monthly',
  [VendorContractTerm.yearly]: 'Yearly',
};

interface VendorCostFieldsProps {
  control: Control<VendorFormValues>;
  errors: FieldErrors<VendorFormValues>;
  disabled: boolean;
}

export function VendorCostFields({ control, errors, disabled }: VendorCostFieldsProps) {
  const costModel = useWatch({ control, name: 'costModel' });
  const contractTerm = useWatch({ control, name: 'contractTerm' });
  const costUnit = costUnitLabel({ costModel, contractTerm });

  return (
    <>
      <Controller
        control={control}
        name="costModel"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="costModel">Cost Model</FieldLabel>
            <Select
              value={field.value ?? NOT_SET}
              onValueChange={(value) => field.onChange(value === NOT_SET ? null : value)}
              disabled={disabled}
            >
              <SelectTrigger id="costModel">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_SET}>Not set</SelectItem>
                {Object.values(VendorCostModel).map((model) => (
                  <SelectItem key={model} value={model}>
                    {COST_MODEL_LABELS[model]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={[errors.costModel]} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="costDollars"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="costDollars">Cost</FieldLabel>
            <InputGroup>
              <InputGroupAddon align="inline-start">$</InputGroupAddon>
              <InputGroupInput
                id="costDollars"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="Not set"
                disabled={disabled}
                value={toInputValue(field.value)}
                onChange={(event) => field.onChange(parseNumberInput(event.target.value))}
                onBlur={field.onBlur}
              />
              {costUnit && <InputGroupAddon align="inline-end">{costUnit}</InputGroupAddon>}
            </InputGroup>
            <FieldDescription>
              {costModel === VendorCostModel.usage_based
                ? 'Estimated spend for one billing period.'
                : 'Cost for one billing period.'}
            </FieldDescription>
            <FieldError errors={[errors.costDollars]} />
          </Field>
        )}
      />

      <Controller
        control={control}
        name="contractTerm"
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor="contractTerm">Contract Term</FieldLabel>
            <Select
              value={field.value ?? NOT_SET}
              onValueChange={(value) => field.onChange(value === NOT_SET ? null : value)}
              disabled={disabled}
            >
              <SelectTrigger id="contractTerm">
                <SelectValue placeholder="Not set" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_SET}>Not set</SelectItem>
                {Object.values(VendorContractTerm).map((term) => (
                  <SelectItem key={term} value={term}>
                    {CONTRACT_TERM_LABELS[term]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError errors={[errors.contractTerm]} />
          </Field>
        )}
      />
    </>
  );
}
