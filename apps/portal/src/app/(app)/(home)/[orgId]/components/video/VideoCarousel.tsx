'use client';

import { useTrainingCompletions } from '@/hooks/use-training-completions';
import type { TrainingVideo } from '@/lib/data/training-videos';
import { getGroupProgress } from '@/lib/training/group-progress';
import type { TrainingGroupId } from '@trycompai/company/training';
import { useState } from 'react';
import { CarouselControls } from './CarouselControls';
import { YoutubeEmbed } from './YoutubeEmbed';

interface VideoCarouselProps {
  /** The training group these videos belong to. */
  groupId: TrainingGroupId;
  videos: readonly TrainingVideo[];
}

export function VideoCarousel({ groupId, videos }: VideoCarouselProps) {
  const { completions, markVideoComplete } = useTrainingCompletions();
  const [isExecuting, setIsExecuting] = useState(false);

  // Which videos count as watched. Training renews yearly, so a member can have
  // a row per video per cycle: during a renewal, last year's rows must not mark
  // the videos as watched again, which is what the shared status logic decides.
  const { completedModuleIds: completedVideoIds } = getGroupProgress({
    groupId,
    completions,
    now: new Date(),
  });

  const mergedVideos = videos.map((metadata) => ({
    ...metadata,
    isCompleted: completedVideoIds.has(metadata.id),
  }));

  const lastCompletedIndex = (() => {
    const completedIndices = mergedVideos
      .map((video, index) => ({ index, completed: video.isCompleted }))
      .filter((item) => item.completed)
      .map((item) => item.index);
    return completedIndices.length > 0
      ? completedIndices[completedIndices.length - 1]
      : 0;
  })();

  const [currentIndex, setCurrentIndex] = useState(lastCompletedIndex);

  const goToPrevious = () => {
    const isFirstVideo = currentIndex === 0;
    setCurrentIndex(isFirstVideo ? mergedVideos.length - 1 : currentIndex - 1);
  };

  const goToNext = () => {
    const currentMetadataId = mergedVideos[currentIndex].id;
    if (!completedVideoIds.has(currentMetadataId)) return;
    const isLastVideo = currentIndex === mergedVideos.length - 1;
    setCurrentIndex(isLastVideo ? 0 : currentIndex + 1);
  };

  const handleVideoComplete = async () => {
    const currentVideo = mergedVideos[currentIndex];
    if (completedVideoIds.has(currentVideo.id)) return;

    setIsExecuting(true);
    try {
      await markVideoComplete(currentVideo.id);
    } finally {
      setIsExecuting(false);
    }
  };

  const isCurrentVideoCompleted = completedVideoIds.has(
    mergedVideos[currentIndex].id,
  );
  const hasNextVideo = currentIndex < mergedVideos.length - 1;
  const allVideosCompleted = videos.every((metadata) =>
    completedVideoIds.has(metadata.id),
  );

  return (
    <div className="space-y-4">
      {allVideosCompleted && (
        <div className="flex w-full flex-col items-center justify-center space-y-2 py-8">
          <h2 className="text-2xl font-semibold">
            All Training Videos Completed!
          </h2>
          <p className="text-muted-foreground text-center">
            You're all done, now your manager won't pester you!
          </p>
        </div>
      )}
      {!allVideosCompleted && (
        <>
          <YoutubeEmbed
            video={mergedVideos[currentIndex]}
            isCompleted={isCurrentVideoCompleted}
            onComplete={handleVideoComplete}
            isMarkingComplete={isExecuting}
            onNext={
              isCurrentVideoCompleted && hasNextVideo ? goToNext : undefined
            }
            allVideosCompleted={allVideosCompleted}
          />
          <CarouselControls
            currentIndex={currentIndex}
            total={mergedVideos.length}
            onPrevious={goToPrevious}
            onNext={
              isCurrentVideoCompleted && hasNextVideo ? goToNext : undefined
            }
          />
        </>
      )}
    </div>
  );
}
