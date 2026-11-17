'use client';

import { ccpaTrainingVideos } from '@/lib/data/training-videos';
import { VideoTrainingAccordionItem } from './VideoTrainingAccordionItem';

export function CcpaTrainingAccordionItem() {
  return (
    <VideoTrainingAccordionItem
      value="ccpa-training"
      title="CCPA Privacy Training"
      description="Complete the CCPA privacy training videos to learn how California privacy law applies to the personal information you handle."
      groupId="ccpa"
      videos={ccpaTrainingVideos}
    />
  );
}
