/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, {useState, useEffect} from 'react';
import {EditVideoPage} from './components/EditVideoPage';
import {ErrorModal} from './components/ErrorModal';
import {VideoCameraIcon} from './components/icons';
import {SavingProgressPage} from './components/SavingProgressPage';
import {ThemeToggle} from './components/ThemeToggle';
import {VideoGrid} from './components/VideoGrid';
import {VideoPlayer} from './components/VideoPlayer';
import {MOCK_VIDEOS} from './constants';
import {Video} from './types';

import {GeneratedVideo, GoogleGenAI} from '@google/genai';

const VEO_MODEL_NAME = 'veo-2.0-generate-001';

const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

type Theme = 'light' | 'dark';

// ---

function bloblToBase64(blob: Blob) {
  return new Promise<string>(async (resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      resolve(url.split(',')[1]);
    };
    reader.readAsDataURL(blob);
  });
}

// ---

async function generateVideoFromText(
  prompt: string,
  numberOfVideos = 1,
): Promise<string[]> {
  let operation = await ai.models.generateVideos({
    model: VEO_MODEL_NAME,
    prompt,
    config: {
      numberOfVideos,
      aspectRatio: '16:9',
      // @google/genai Coding Guidelines: The `quality` property is not supported in the `generateVideos` config.
    },
  });

  while (!operation.done) {
    await new Promise((resolve) => setTimeout(resolve, 10000));
    console.log('...Generating...');
    operation = await ai.operations.getVideosOperation({operation});
  }

  if (operation?.response) {
    const videos = operation.response?.generatedVideos;
    if (videos === undefined || videos.length === 0) {
      throw new Error('No videos generated');
    }

    return await Promise.all(
      videos.map(async (generatedVideo: GeneratedVideo) => {
        const url = decodeURIComponent(generatedVideo.video.uri);
        const res = await fetch(`${url}&key=${process.env.API_KEY}`);
        if (!res.ok) {
          throw new Error(
            `Failed to fetch video: ${res.status} ${res.statusText}`,
          );
        }
        const blob = await res.blob();
        return bloblToBase64(blob);
      }),
    );
  } else {
    throw new Error('No videos generated');
  }
}

const parseErrorMessage = (error: unknown): string[] => {
  if (error instanceof Error) {
    const message = error.message;
    // Check for specific error patterns from the API
    if (message.includes('API key not valid')) {
      return [
        'Your API key is not valid.',
        'Please check your API key and try again.',
      ];
    }
    if (message.includes('permission denied')) {
      return [
        'Permission Denied.',
        'This model may require a specific tier or project configuration. Please check your project settings.',
      ];
    }
    if (message.includes('User location is not supported')) {
      return [
        'Location Not Supported.',
        'The model is not available in your current location.',
      ];
    }
    if (message.includes('Billing account not found')) {
      return [
        'Billing Issue.',
        'A valid billing account is required. Please select a Cloud Project with billing enabled.',
      ];
    }
    // Return the actual error message if it's not one of the known patterns
    return ['Video generation failed:', message];
  }
  // Fallback for unknown error types
  return [
    'An unexpected error occurred.',
    'Please check the console for more details.',
  ];
};

/**
 * Main component for the Veo3 Gallery app.
 * It manages the state of videos, playing videos, editing videos and error handling.
 */
export const App: React.FC = () => {
  const [videos, setVideos] = useState<Video[]>(MOCK_VIDEOS);
  const [playingVideo, setPlayingVideo] = useState<Video | null>(null);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [generationError, setGenerationError] = useState<string[] | null>(
    null,
  );
  const [promptInput, setPromptInput] = useState('');
  const [generatedVideosCount, setGeneratedVideosCount] = useState<number>(
    () => {
      try {
        const savedCount = window.localStorage.getItem('generatedVideosCount');
        return savedCount ? parseInt(savedCount, 10) : 0;
      } catch (error) {
        console.error('Could not read from localStorage', error);
        return 0;
      }
    },
  );
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const savedTheme = window.localStorage.getItem('theme') as Theme | null;
      if (savedTheme) {
        return savedTheme;
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } catch (error) {
      return 'dark';
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'generatedVideosCount',
        generatedVideosCount.toString(),
      );
    } catch (error) {
      console.error('Could not write to localStorage', error);
    }
  }, [generatedVideosCount]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    try {
      localStorage.setItem('theme', theme);
    } catch (error) {
      console.error('Could not write to localStorage', error);
    }
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const handlePlayVideo = (video: Video) => {
    setPlayingVideo(video);
  };

  const handleClosePlayer = () => {
    setPlayingVideo(null);
  };

  const handleStartEdit = (video: Video) => {
    setPlayingVideo(null); // Close player
    setEditingVideo(video); // Open edit page
  };

  const handleCancelEdit = () => {
    setEditingVideo(null); // Close edit page, return to grid
  };

  // @google/genai Coding Guidelines: The `quality` property is not supported in the `generateVideos` config.
  const handleSaveEdit = async (originalVideo: Video) => {
    setEditingVideo(null);
    setIsSaving(true);
    setGenerationError(null);

    try {
      const promptText = originalVideo.description;
      console.log(`Generating video...`, promptText);
      const videoObjects = await generateVideoFromText(promptText);

      if (!videoObjects || videoObjects.length === 0) {
        throw new Error('Video generation returned no data.');
      }

      console.log('Generated video data received.');

      const mimeType = 'video/mp4';
      const videoSrc = videoObjects[0];
      const src = `data:${mimeType};base64,${videoSrc}`;

      const newVideo: Video = {
        id: self.crypto.randomUUID(),
        title: `Remix of "${originalVideo.title}"`,
        description: originalVideo.description,
        videoUrl: src,
      };

      setVideos((currentVideos) => [newVideo, ...currentVideos]);
      setPlayingVideo(newVideo); // Go to the new video
      setGeneratedVideosCount((prevCount) => prevCount + 1);
    } catch (error) {
      console.error('Video generation failed:', error);
      setGenerationError(parseErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateNewVideo = async () => {
    if (!promptInput.trim()) {
      return;
    }
    setIsSaving(true);
    setGenerationError(null);

    try {
      const promptText = promptInput;
      console.log(`Generating video from new prompt...`, promptText);
      const videoObjects = await generateVideoFromText(promptText);

      if (!videoObjects || videoObjects.length === 0) {
        throw new Error('Video generation returned no data.');
      }

      console.log('Generated video data received.');

      const mimeType = 'video/mp4';
      const videoSrc = videoObjects[0];
      const src = `data:${mimeType};base64,${videoSrc}`;

      const newVideo: Video = {
        id: self.crypto.randomUUID(),
        title: `Generated: "${promptText.substring(0, 30)}${
          promptText.length > 30 ? '...' : ''
        }"`,
        description: promptText,
        videoUrl: src,
      };

      setVideos((currentVideos) => [newVideo, ...currentVideos]);
      setPlayingVideo(newVideo); // Go to the new video
      setGeneratedVideosCount((prevCount) => prevCount + 1);
      setPromptInput(''); // Clear input after success
    } catch (error) {
      console.error('Video generation failed:', error);
      setGenerationError(parseErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  if (isSaving) {
    return <SavingProgressPage />;
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
      {editingVideo ? (
        <EditVideoPage
          video={editingVideo}
          onSave={handleSaveEdit}
          onCancel={handleCancelEdit}
        />
      ) : (
        <div className="mx-auto max-w-[1080px]">
          <header className="p-6 md:p-8 flex flex-col items-center text-center relative">
            <div className="absolute top-4 right-4">
              <ThemeToggle theme={theme} onToggle={handleToggleTheme} />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-purple-400 via-pink-500 to-red-500 text-transparent bg-clip-text inline-flex items-center gap-4">
              <VideoCameraIcon className="w-10 h-10 md:w-12 md:h-12" />
              <span>Veo Gallery</span>
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2 text-lg">
              Select a video to remix or enter a prompt to generate a new one
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
              You've generated{' '}
              <span className="font-bold text-purple-500 dark:text-purple-400">
                {generatedVideosCount}
              </span>{' '}
              {generatedVideosCount === 1 ? 'video' : 'videos'}.
            </p>
          </header>
          <main className="px-4 md:px-8 pb-8">
            <div className="mb-8 p-6 bg-gray-50 dark:bg-gray-800/50 rounded-lg shadow-md">
              <label
                htmlFor="prompt-input"
                className="block text-lg font-medium text-gray-700 dark:text-gray-300 mb-3">
                Create a new video from a text prompt
              </label>
              <div className="flex flex-col sm:flex-row gap-4 items-start">
                <textarea
                  id="prompt-input"
                  rows={3}
                  className="flex-grow w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-lg p-3 text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-shadow duration-200 disabled:opacity-50"
                  placeholder="e.g., A majestic grizzly bear standing knee-deep in the rapids..."
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  disabled={isSaving}
                />
                <button
                  onClick={handleGenerateNewVideo}
                  disabled={isSaving || !promptInput.trim()}
                  className="w-full sm:w-auto px-6 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition-colors disabled:bg-purple-400 dark:disabled:bg-purple-800 disabled:cursor-not-allowed flex-shrink-0 self-stretch sm:self-end">
                  Generate Video
                </button>
              </div>
            </div>
            <VideoGrid videos={videos} onPlayVideo={handlePlayVideo} />
          </main>
        </div>
      )}

      {playingVideo && (
        <VideoPlayer
          video={playingVideo}
          onClose={handleClosePlayer}
          onEdit={handleStartEdit}
        />
      )}

      {generationError && (
        <ErrorModal
          message={generationError}
          onClose={() => setGenerationError(null)}
          onSelectProject={async () => await window.aistudio?.openSelectKey()}
        />
      )}
    </div>
  );
};
