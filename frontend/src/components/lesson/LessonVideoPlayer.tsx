import React from 'react';
import {
  Video,
  Clock,
  RotateCcw,
  RotateCw,
  Gauge,
  PictureInPicture
} from 'lucide-react';
import type { Lesson } from '../../types/models.ts';
import { formatPlaybackTime, SUPPORTED_PLAYBACK_SPEEDS } from '../../services/domainLogic.ts';
import { useLanguage } from '../../hooks/useLanguage.ts';
import { Badge, cn } from '../ui/index.tsx';

export interface LessonVideoPlayerProps {
  lesson: Lesson;
  playbackUrl: string | null;
  isLocalMedia: boolean;
  mediaLoading: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  currentPlaybackSeconds: number;
  resumedTime: number | null;
  playbackSpeed: number;
  playerOverlayToast: string | null;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
  onPause: () => void;
  onJump: (deltaSeconds: number) => void;
  onSpeedChange: (speed: number) => void;
  onTogglePip: () => Promise<void>;
  onAssociateFile: (file: File) => Promise<void>;
}

export const LessonVideoPlayer: React.FC<LessonVideoPlayerProps> = ({
  lesson,
  playbackUrl,
  isLocalMedia,
  mediaLoading,
  videoRef,
  currentPlaybackSeconds,
  resumedTime,
  playbackSpeed,
  playerOverlayToast,
  onLoadedMetadata,
  onTimeUpdate,
  onPause,
  onJump,
  onSpeedChange,
  onTogglePip,
  onAssociateFile
}) => {
  const { t } = useLanguage();

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-line', playbackUrl ? 'bg-black' : 'bg-surface')}>
      {playbackUrl ? (
        <div className="relative group">
          <video
            ref={videoRef}
            key={lesson.id}
            src={playbackUrl}
            controls
            onLoadedMetadata={onLoadedMetadata}
            onTimeUpdate={onTimeUpdate}
            onPause={onPause}
            className="max-h-[420px] w-full bg-black object-contain"
          />
          {playerOverlayToast && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="animate-fade-in rounded-lg bg-black/85 px-4 py-2 font-mono text-title font-bold text-white shadow-lg backdrop-blur-sm">
                {playerOverlayToast}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <Video size={34} className="mb-2 text-faint" aria-hidden="true" />
          <p className="text-secondary text-muted">No hay archivo multimedia local disponible para esta lección.</p>
          <p className="type-meta mt-1">
            Usa «Vincular carpeta local» en la Biblioteca o asocia un archivo individual.
          </p>
          {!mediaLoading && lesson.media_url && (
            <p className="mt-2 break-all font-mono text-micro text-accent">Archivo esperado: {lesson.media_url}</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center gap-2.5 text-meta text-muted">
          <span className="flex items-center gap-1.5">
            <Video size={13} className="text-accent" aria-hidden="true" />
            {isLocalMedia
              ? t('lessonWorkspace.mediaLocal')
              : playbackUrl
                ? t('lessonWorkspace.mediaRemote')
                : t('lessonWorkspace.mediaNone')}
          </span>
          {playbackUrl && (
            <>
              <span className="inline-flex items-center gap-1 font-mono text-micro text-ink">
                <Clock size={11} className="text-accent" aria-hidden="true" />
                {formatPlaybackTime(currentPlaybackSeconds)}
              </span>

              <span className="text-line-strong" aria-hidden="true">|</span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onJump(-10)}
                  title="Retroceder 10s (Atajo: J o Flecha Izquierda)"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-meta text-muted transition hover:bg-accent-soft/60 hover:text-ink"
                >
                  <RotateCcw size={12} aria-hidden="true" />
                  <span>-10s</span>
                </button>
                <button
                  type="button"
                  onClick={() => onJump(10)}
                  title="Avanzar 10s (Atajo: L o Flecha Derecha)"
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-meta text-muted transition hover:bg-accent-soft/60 hover:text-ink"
                >
                  <RotateCw size={12} aria-hidden="true" />
                  <span>+10s</span>
                </button>
              </div>

              <div className="flex items-center gap-0.5 rounded-lg border border-line bg-canvas px-1 py-0.5" title={t('lessonWorkspace.playbackSpeedTitle')}>
                <Gauge size={12} className="mx-1 text-muted" aria-hidden="true" />
                {SUPPORTED_PLAYBACK_SPEEDS.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onSpeedChange(s)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-micro font-medium transition',
                      playbackSpeed === s
                        ? 'bg-accent text-on-accent shadow-xs'
                        : 'text-muted hover:text-ink'
                    )}
                  >
                    {s}x
                  </button>
                ))}
              </div>

              {typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (
                <button
                  type="button"
                  onClick={() => void onTogglePip()}
                  title="Ventana flotante Picture-in-Picture"
                  className="rounded p-1.5 text-muted transition hover:bg-accent-soft/60 hover:text-ink"
                  aria-label="Ventana flotante Picture-in-Picture"
                >
                  <PictureInPicture size={14} aria-hidden="true" />
                </button>
              )}
            </>
          )}
          {resumedTime !== null && resumedTime > 0 && (
            <Badge tone="info" className="font-mono text-micro">
              Reanudado en {formatPlaybackTime(resumedTime)}
            </Badge>
          )}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-meta font-medium text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink">
          <Video size={13} aria-hidden="true" />
          <span>Asociar archivo local</span>
          <input
            type="file"
            accept="video/*,audio/*,.mp4,.webm,.ogg,.mov,.m4v,.mp3,.wav,.m4a"
            className="hidden"
            aria-label={t('lessonWorkspace.attachMediaLabel')}
            onChange={async e => {
              const file = e.target.files?.[0];
              if (file) await onAssociateFile(file);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
};
