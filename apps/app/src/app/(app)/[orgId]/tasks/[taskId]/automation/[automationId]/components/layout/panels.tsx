'use client';

import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import { VERTICAL_COOKIE } from './sizing';

interface HProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLayout?: number[]; // Now optional since we're not using it
}

export function Horizontal({ defaultLayout, left, right }: HProps) {
  return (
    <div className="h-full w-full flex">
      <div className="w-1/2 h-full flex-shrink-0">{left}</div>
      <div className="w-1/2 h-full flex-shrink-0">{right}</div>
    </div>
  );
}

interface VProps {
  defaultLayout: number[];
  top: React.ReactNode;
  middle: React.ReactNode;
  bottom: React.ReactNode;
}

const PANEL_IDS = ['top', 'middle', 'bottom'] as const;

// Persisted sizes are percentages; react-resizable-panels needs an explicit unit (a bare number is pixels).
function toPercent(size: number | undefined): string | undefined {
  return Number.isFinite(size) ? `${size}%` : undefined;
}

export function Vertical({ defaultLayout, top, middle, bottom }: VProps) {
  const handleLayoutChanged = (layout: Layout) => {
    const sizes = PANEL_IDS.map((id) => layout[id]);
    if (!sizes.every((size) => Number.isFinite(size))) return;
    document.cookie = `${VERTICAL_COOKIE}=${JSON.stringify(sizes)}`;
  };
  return (
    <Group orientation="vertical" onLayoutChanged={handleLayoutChanged} className="h-full">
      <Panel id={PANEL_IDS[0]} defaultSize={toPercent(defaultLayout[0])}>
        {top}
      </Panel>
      <Separator className="h-2" />
      <Panel id={PANEL_IDS[1]} defaultSize={toPercent(defaultLayout[1])}>
        {middle}
      </Panel>
      <Separator className="h-2" />
      <Panel id={PANEL_IDS[2]} defaultSize={toPercent(defaultLayout[2])}>
        {bottom}
      </Panel>
    </Group>
  );
}
