'use client';

import { trainingVideos } from '@/lib/data/training-videos';
import { VideoTrainingAccordionItem } from './VideoTrainingAccordionItem';

export function GeneralTrainingAccordionItem() {
  return (
    <VideoTrainingAccordionItem
      value="general-training"
      title="Security Awareness Training"
      description="Complete the security awareness training videos to learn about best practices for keeping company data secure."
      groupId="general"
      videos={trainingVideos}
    />
  );
}
