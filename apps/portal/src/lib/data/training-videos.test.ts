import { ALL_TRAINING_VIDEO_IDS, CCPA_TRAINING_VIDEO_IDS } from '@trycompai/company/training';
import { describe, expect, it } from 'vitest';
import { ccpaTrainingVideos, trainingVideos } from './training-videos';

describe('training video data', () => {
  it('has a CCPA video for every CCPA module, in catalog order', () => {
    expect(ccpaTrainingVideos.map((video) => video.id)).toEqual([...CCPA_TRAINING_VIDEO_IDS]);
  });

  it('only ever lists videos the completion paths accept', () => {
    for (const video of [...trainingVideos, ...ccpaTrainingVideos]) {
      expect((ALL_TRAINING_VIDEO_IDS as readonly string[]).includes(video.id)).toBe(true);
    }
  });

  it('keeps each video link consistent with its YouTube id', () => {
    for (const video of ccpaTrainingVideos) {
      expect(video.url).toBe(`https://www.youtube.com/watch?v=${video.youtubeId}`);
    }
  });

  it('uses the two provided CCPA videos', () => {
    expect(ccpaTrainingVideos.map((video) => video.youtubeId)).toEqual([
      'GWIPHndskVY',
      '5gVTXuW_NnA',
    ]);
  });

  it('does not mix CCPA videos into the general training list', () => {
    expect(trainingVideos.some((video) => video.id.startsWith('ccpa-'))).toBe(false);
  });
});
