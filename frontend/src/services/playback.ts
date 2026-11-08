/**
 * Media playback tracking, timestamp parsing/formatting, and speed stepping.
 */

/**
 * Formats seconds as 'mm:ss' or 'hh:mm:ss'.
 */
export function formatPlaybackTime(seconds: number): string {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) {
    return '00:00';
  }
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/**
 * Converts a time string like '01:15', '01:05:30', or '[01:15]' to total seconds.
 */
export function parseTimestampToSeconds(timestamp: string): number | null {
  if (!timestamp) return null;
  const clean = timestamp.replace(/^\[/, '').replace(/\]$/, '').trim();
  const parts = clean.split(':').map(p => parseInt(p, 10));

  if (parts.some(p => isNaN(p) || p < 0)) return null;

  if (parts.length === 2) {
    const [mins, secs] = parts;
    if (secs >= 60) return null;
    return mins * 60 + secs;
  }

  if (parts.length === 3) {
    const [hrs, mins, secs] = parts;
    if (mins >= 60 || secs >= 60) return null;
    return hrs * 3600 + mins * 60 + secs;
  }

  return null;
}

export interface TimestampPart {
  text: string;
  isTimestamp: boolean;
  seconds?: number;
  rawTimestamp?: string;
}

/**
 * Splits text into plain-text chunks and interactive [mm:ss]/[hh:mm:ss] timestamps.
 */
export function extractTimestampParts(content: string): TimestampPart[] {
  if (!content) return [];
  const regex = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/g;
  const parts: TimestampPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        text: content.slice(lastIndex, match.index),
        isTimestamp: false
      });
    }

    const fullTag = match[0];
    const inner = fullTag.slice(1, -1);
    const secs = parseTimestampToSeconds(inner);

    if (secs !== null) {
      parts.push({
        text: fullTag,
        isTimestamp: true,
        seconds: secs,
        rawTimestamp: inner
      });
    } else {
      parts.push({
        text: fullTag,
        isTimestamp: false
      });
    }

    lastIndex = match.index + fullTag.length;
  }

  if (lastIndex < content.length) {
    parts.push({
      text: content.slice(lastIndex),
      isTimestamp: false
    });
  }

  return parts;
}

/**
 * Safely reads saved playback seconds for a lesson from localStorage.
 * Returns null when missing, invalid, or when localStorage is unavailable.
 */
export function getStoredPlaybackSeconds(lessonId: string): number | null {
  if (typeof localStorage === 'undefined' || !lessonId) return null;
  try {
    const raw = localStorage.getItem(`crossedarts-playback:${lessonId}`);
    if (!raw) return null;
    const secs = parseFloat(raw);
    return !isNaN(secs) && secs > 0 ? secs : null;
  } catch {
    return null;
  }
}

export const SUPPORTED_PLAYBACK_SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/**
 * Computes the new playback second after a time jump (forward or backward),
 * clamped strictly to [0, duration].
 */
export function calculatePlaybackJump(currentTime: number, deltaSeconds: number, duration: number = Infinity): number {
  const safeCurrent = isNaN(currentTime) || currentTime < 0 ? 0 : currentTime;
  const safeDuration = isNaN(duration) || duration <= 0 ? Infinity : duration;
  const target = safeCurrent + deltaSeconds;
  return Math.max(0, Math.min(safeDuration, target));
}

/**
 * Resolves the next playback speed when stepping up or down through the
 * app's standard speeds.
 */
export function resolveNextPlaybackSpeed(currentSpeed: number, direction: 'increase' | 'decrease'): number {
  const speeds = SUPPORTED_PLAYBACK_SPEEDS;
  const idx = speeds.indexOf(currentSpeed as any);
  if (direction === 'increase') {
    if (idx === -1) {
      const next = speeds.find(s => s > currentSpeed);
      return next ?? speeds[speeds.length - 1];
    }
    return idx < speeds.length - 1 ? speeds[idx + 1] : speeds[idx];
  } else {
    if (idx === -1) {
      const prev = [...speeds].reverse().find(s => s < currentSpeed);
      return prev ?? speeds[0];
    }
    return idx > 0 ? speeds[idx - 1] : speeds[0];
  }
}
