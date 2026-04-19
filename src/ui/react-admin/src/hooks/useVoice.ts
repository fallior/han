/**
 * useVoice — React hook for PTS (Press to Start) and TTM (Talk to Me)
 * Phase 1 voice integration. Jim's spec, S125.
 * S126: Uses GET /tts/:messageId for cached audio, better error handling.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Message } from '../types';
import { apiFetch } from '../api';

const SPEED_OPTIONS = [1, 1.25, 1.5, 2] as const;
const SPEED_STORAGE_KEY = 'han-voice-playback-speed';

interface UseVoiceReturn {
    // PTS state
    isRecording: boolean;
    isTranscribing: boolean;
    toggleRecording: () => Promise<string | null>;

    // TTM state
    playbackState: 'idle' | 'loading' | 'playing' | 'paused';
    currentMessageId: string | null;
    queuePosition: number;
    queueLength: number;

    // Playback controls
    speakMessage: (msg: Message) => Promise<void>;
    speakUnread: (messages: Message[]) => Promise<void>;
    pausePlayback: () => void;
    resumePlayback: () => void;
    escapePlayback: () => void;
    skipMessage: () => void;

    // Speed control
    playbackSpeed: number;
    cycleSpeed: () => void;

    // Scrubber / progress
    currentTime: number;
    duration: number;
    seekTo: (time: number) => void;

    // Skip ahead/back
    skipAhead: (seconds?: number) => void;
    skipBack: (seconds?: number) => void;
}

export function useVoice(): UseVoiceReturn {
    // PTS state
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // TTM state
    const [playbackState, setPlaybackState] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle');
    const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
    const [queuePosition, setQueuePosition] = useState(0);
    const playbackQueueRef = useRef<Message[]>([]);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const abortRef = useRef(false);

    // Speed control — persisted to localStorage
    const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
        try { return parseFloat(localStorage.getItem(SPEED_STORAGE_KEY) || '1') || 1; }
        catch { return 1; }
    });

    // Scrubber / progress state
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const timeUpdateRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // ── PTS: Press to Start ────────────────────────────────

    const startRecording = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            const recorder = new MediaRecorder(stream, { mimeType });
            audioChunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            recorder.start(1000); // collect chunks every second
            mediaRecorderRef.current = recorder;
            setIsRecording(true);

            // Silence timeout: 30s of silence or 5min max
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            let silentSeconds = 0;
            let totalSeconds = 0;
            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            const checkSilence = setInterval(() => {
                analyser.getByteFrequencyData(dataArray);
                const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                totalSeconds++;

                if (avg < 5) {
                    silentSeconds++;
                } else {
                    silentSeconds = 0;
                }

                // 30s silence or 5min total
                if (silentSeconds >= 30 || totalSeconds >= 300) {
                    clearInterval(checkSilence);
                    stopRecordingInternal();
                }
            }, 1000);

            silenceTimerRef.current = checkSilence as unknown as ReturnType<typeof setTimeout>;
        } catch (err) {
            console.error('[PTS] Microphone access failed:', err);
        }
    }, []);

    const stopRecordingInternal = useCallback(async (): Promise<string | null> => {
        return new Promise((resolve) => {
            const recorder = mediaRecorderRef.current;
            if (!recorder || recorder.state === 'inactive') {
                setIsRecording(false);
                resolve(null);
                return;
            }

            if (silenceTimerRef.current) {
                clearInterval(silenceTimerRef.current as unknown as number);
                silenceTimerRef.current = null;
            }

            recorder.onstop = async () => {
                setIsRecording(false);
                setIsTranscribing(true);

                // Stop all tracks
                streamRef.current?.getTracks().forEach(t => t.stop());
                streamRef.current = null;

                const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });

                try {
                    const response = await apiFetch('/api/voice/stt', {
                        method: 'POST',
                        headers: { 'Content-Type': 'audio/webm' },
                        body: blob
                    });

                    if (!response.ok) {
                        console.error('[PTS] STT failed:', await response.text());
                        setIsTranscribing(false);
                        resolve(null);
                        return;
                    }

                    const result = await response.json();
                    setIsTranscribing(false);
                    resolve(result.text || null);
                } catch (err) {
                    console.error('[PTS] STT error:', err);
                    setIsTranscribing(false);
                    resolve(null);
                }
            };

            recorder.stop();
        });
    }, []);

    const toggleRecording = useCallback(async (): Promise<string | null> => {
        if (isRecording) {
            return stopRecordingInternal();
        } else {
            await startRecording();
            return null;
        }
    }, [isRecording, startRecording, stopRecordingInternal]);

    // ── Speed control ─────────────────────────────────────

    const cycleSpeed = useCallback(() => {
        setPlaybackSpeed(prev => {
            const idx = SPEED_OPTIONS.indexOf(prev as typeof SPEED_OPTIONS[number]);
            const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
            try { localStorage.setItem(SPEED_STORAGE_KEY, String(next)); } catch {}
            // Apply to current audio if playing
            if (audioRef.current) audioRef.current.playbackRate = next;
            return next;
        });
    }, []);

    // ── Scrubber controls ─────────────────────────────────

    const seekTo = useCallback((time: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = Math.max(0, Math.min(time, audioRef.current.duration || 0));
            setCurrentTime(audioRef.current.currentTime);
        }
    }, []);

    const skipAhead = useCallback((seconds: number = 15) => {
        if (audioRef.current) {
            audioRef.current.currentTime = Math.min(audioRef.current.currentTime + seconds, audioRef.current.duration || 0);
            setCurrentTime(audioRef.current.currentTime);
        }
    }, []);

    const skipBack = useCallback((seconds: number = 15) => {
        if (audioRef.current) {
            audioRef.current.currentTime = Math.max(audioRef.current.currentTime - seconds, 0);
            setCurrentTime(audioRef.current.currentTime);
        }
    }, []);

    // Clean up time tracking on unmount
    useEffect(() => {
        return () => {
            if (timeUpdateRef.current) clearInterval(timeUpdateRef.current);
        };
    }, []);

    // ── TTM: Talk to Me ────────────────────────────────────

    const startTimeTracking = useCallback((audio: HTMLAudioElement) => {
        if (timeUpdateRef.current) clearInterval(timeUpdateRef.current);
        setCurrentTime(0);
        setDuration(0);

        audio.onloadedmetadata = () => {
            setDuration(audio.duration);
        };

        // Update current time ~2x/second
        timeUpdateRef.current = setInterval(() => {
            if (audio && !audio.paused) {
                setCurrentTime(audio.currentTime);
                if (audio.duration && !isNaN(audio.duration)) setDuration(audio.duration);
            }
        }, 500);
    }, []);

    const playAudioForMessage = useCallback(async (msg: Message): Promise<boolean> => {
        if (abortRef.current) return false;

        setCurrentMessageId(msg.id);
        setPlaybackState('loading');

        try {
            // Use GET endpoint — serves cached audio, handles chunking server-side
            const response = await apiFetch(`/api/voice/tts/${msg.id}`);

            if (!response.ok || abortRef.current) {
                if (!abortRef.current) {
                    console.error(`[TTM] TTS failed for message ${msg.id}: ${response.status}`);
                }
                return false;
            }

            const audioBlob = await response.blob();
            if (abortRef.current) return false;

            const url = URL.createObjectURL(audioBlob);

            return new Promise((resolve) => {
                const audio = new Audio(url);
                audioRef.current = audio;

                // Apply current speed setting
                audio.playbackRate = playbackSpeed;

                // Start time tracking for scrubber
                startTimeTracking(audio);

                audio.onended = async () => {
                    URL.revokeObjectURL(url);
                    if (timeUpdateRef.current) clearInterval(timeUpdateRef.current);
                    // Increment listen count — natural completion
                    try {
                        await apiFetch(`/api/voice/listened/${msg.id}`, { method: 'PATCH' });
                    } catch { /* best effort */ }
                    resolve(true);
                };

                audio.onerror = (e) => {
                    console.error(`[TTM] Audio playback error for message ${msg.id}:`, e);
                    URL.revokeObjectURL(url);
                    if (timeUpdateRef.current) clearInterval(timeUpdateRef.current);
                    resolve(false);
                };

                if (!abortRef.current) {
                    setPlaybackState('playing');
                    audio.play().catch((err) => {
                        console.error(`[TTM] play() rejected for message ${msg.id}:`, err);
                        URL.revokeObjectURL(url);
                        resolve(false);
                    });
                } else {
                    URL.revokeObjectURL(url);
                    resolve(false);
                }
            });
        } catch (err) {
            console.error(`[TTM] Error for message ${msg.id}:`, err);
            return false;
        }
    }, [playbackSpeed, startTimeTracking]);

    const playQueue = useCallback(async (messages: Message[], startPos: number = 0) => {
        setPlaybackState('loading');
        abortRef.current = false;

        for (let i = startPos; i < messages.length; i++) {
            if (abortRef.current) break;
            setQueuePosition(i);

            // Prefetch next message while current plays (zero gap between messages)
            if (i + 1 < messages.length) {
                apiFetch(`/api/voice/tts/${messages[i + 1].id}`).catch(() => {});
            }

            const completed = await playAudioForMessage(messages[i]);
            if (!completed && !abortRef.current) {
                // Audio error — skip to next
                continue;
            }
        }

        if (!abortRef.current) {
            setPlaybackState('idle');
            setCurrentMessageId(null);
            setQueuePosition(0);
            playbackQueueRef.current = [];
        }
    }, [playAudioForMessage]);

    const speakMessage = useCallback(async (msg: Message) => {
        // Stop any current playback
        escapePlaybackInternal();

        playbackQueueRef.current = [msg];
        await playQueue([msg]);
    }, [playQueue]);

    const speakUnread = useCallback(async (messages: Message[]) => {
        const unread = messages.filter(m => m.role !== 'human' && (m.listen_count || 0) === 0);
        if (unread.length === 0) return;

        // Stop any current playback
        escapePlaybackInternal();

        playbackQueueRef.current = unread;
        await playQueue(unread);
    }, [playQueue]);

    const pausePlayback = useCallback(() => {
        if (audioRef.current && playbackState === 'playing') {
            audioRef.current.pause();
            setPlaybackState('paused');
        }
    }, [playbackState]);

    const resumePlayback = useCallback(() => {
        if (audioRef.current && playbackState === 'paused') {
            audioRef.current.play();
            setPlaybackState('playing');
        }
    }, [playbackState]);

    const escapePlaybackInternal = () => {
        abortRef.current = true;
        if (timeUpdateRef.current) { clearInterval(timeUpdateRef.current); timeUpdateRef.current = null; }
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current = null;
        }
        setPlaybackState('idle');
        setCurrentMessageId(null);
        setQueuePosition(0);
        setCurrentTime(0);
        setDuration(0);
        playbackQueueRef.current = [];
    };

    const escapePlayback = useCallback(() => {
        escapePlaybackInternal();
    }, []);

    const skipMessage = useCallback(() => {
        // Skip current without incrementing listen count
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
        const nextPos = queuePosition + 1;
        if (nextPos < playbackQueueRef.current.length) {
            setQueuePosition(nextPos);
            // Continue queue from next position
            playQueue(playbackQueueRef.current, nextPos);
        } else {
            escapePlaybackInternal();
        }
    }, [queuePosition, playQueue]);

    return {
        isRecording,
        isTranscribing,
        toggleRecording,
        playbackState,
        currentMessageId,
        queuePosition,
        queueLength: playbackQueueRef.current.length,
        speakMessage,
        speakUnread,
        pausePlayback,
        resumePlayback,
        escapePlayback,
        skipMessage,
        playbackSpeed,
        cycleSpeed,
        currentTime,
        duration,
        seekTo,
        skipAhead,
        skipBack
    };
}
