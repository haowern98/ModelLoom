import { useState } from 'react';
import type { SampleRange } from '../../mocks/cluster';
import { allocationMessage, allocationSlots, resizeLayerEnd } from './card-allocation';
import type { AllocationSlot } from './card-allocation';

export interface CardAllocationEditor {
  hardwareId: string;
  first: string;
  last: string;
  error: string;
  focusInput: boolean;
}
export interface CardAllocation {
  editor: CardAllocationEditor | null;
  message: string;
  open: (id: string) => void;
  resize: (id: string, last: number) => void;
  fields: (first: string, last: string) => void;
  done: () => boolean;
  cancel: () => void;
}

/** Card edits stay local until Done, then replace the configuration's runs in one history step. */
export function useCardAllocation({
  ranges,
  ids,
  total,
  context,
  disabled,
  commit,
}: {
  ranges: readonly SampleRange[];
  ids: readonly string[];
  total: number;
  context: string;
  disabled: boolean;
  commit: (next: readonly SampleRange[]) => void;
}) {
  const [draft, setDraft] = useState<{
    context: string;
    ranges: readonly SampleRange[];
    editor: CardAllocationEditor;
    slots: readonly AllocationSlot[];
  } | null>(null);
  // A changed selection, inventory, undo or external edit invalidates the preview before it can commit.
  const current = draft?.context === context ? draft : null;
  const visible = current?.ranges ?? ranges;
  const slotsFor = (id: string) =>
    current?.editor.hardwareId === id ? current.slots : allocationSlots(ids, visible);
  const preview = (
    id: string,
    next: readonly SampleRange[],
    focusInput: boolean,
    slots = slotsFor(id),
  ) => {
    if (disabled || !ids.includes(id)) return;
    const slot = allocationSlots(ids, next).find((slot) => slot.hardwareId === id)!;
    setDraft({
      context,
      ranges: next,
      slots,
      editor: {
        hardwareId: id,
        first: slot.count ? String(slot.first) : '',
        last: slot.count ? String(slot.first + slot.count - 1) : '',
        error: '',
        focusInput,
      },
    });
  };
  const validate = (first: string, last: string) => {
    if (first === '' && last === '') return '';
    if (!/^\d+$/u.test(first) || !/^\d+$/u.test(last))
      return 'Enter a whole number in both fields.';
    if (Number(first) >= total || Number(last) >= total)
      return `Choose layers between 0 and ${total - 1}.`;
    if (Number(last) < Number(first)) return 'Last layer must be at least the first layer.';
    return '';
  };
  const allocation: CardAllocation = {
    editor: current?.editor ?? null,
    message: current ? allocationMessage(visible, total) : '',
    open: (id) => preview(id, visible, true),
    resize: (id, last) => {
      const slots = slotsFor(id);
      const first =
        current?.editor.hardwareId === id &&
        current.editor.first !== '' &&
        !validate(current.editor.first, current.editor.last)
          ? Number(current.editor.first)
          : undefined;
      preview(id, resizeLayerEnd(slots, id, last, total, first), false, slots);
    },
    fields: (first, last) => {
      if (!current || disabled) return;
      const error = validate(first, last);
      const id = current.editor.hardwareId;
      setDraft({
        ...current,
        editor: { ...current.editor, first, last, error },
        ranges: error
          ? current.ranges
          : first === '' && last === ''
            ? ranges.filter((range) => range.hardwareId !== id)
            : resizeLayerEnd(current.slots, id, Number(last), total, Number(first)),
      });
    },
    done: () => {
      if (!current || disabled) return false;
      const error = validate(current.editor.first, current.editor.last);
      if (error) {
        setDraft({ ...current, editor: { ...current.editor, error } });
        return false;
      }
      commit(current.ranges);
      setDraft(null);
      return true;
    },
    cancel: () => setDraft(null),
  };
  return { ranges: visible, allocation, editing: Boolean(current) };
}
