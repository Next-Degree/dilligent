'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ds';
import type { ReactNode } from 'react';

export function PortalTabs(props: { overview: ReactNode; access: ReactNode }) {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="access">Request access</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <div className="space-y-10 pt-6">{props.overview}</div>
      </TabsContent>
      <TabsContent value="access">
        <div className="space-y-10 pt-6">{props.access}</div>
      </TabsContent>
    </Tabs>
  );
}
