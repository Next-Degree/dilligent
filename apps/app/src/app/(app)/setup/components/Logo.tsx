import { Icons } from '@trycompai/ui/icons';
import { HTMLAttributes } from 'react';

export const Logo = (props: HTMLAttributes<HTMLDivElement>) => (
  <div className="flex items-center gap-2.5" {...props}>
    <Icons.Logo className="h-10 w-10" />
    <span className="text-2xl font-semibold text-[#09090B]">Dilligent</span>
  </div>
);
