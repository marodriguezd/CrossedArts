/**
 * Servicio de Audio TTS (Text-to-Speech) y Reconocimiento de Voz (Speech-to-Text)
 * 100% nativo y offline mediante la Web Speech API del navegador.
 */

export interface SpeechSettings {
  voiceUri?: string;
  rate: number;
  pitch: number;
  autoReadFlashcards: boolean;
  lang: string;
}

const STORAGE_KEY = 'crossedarts-speech-settings';

const DEFAULT_SETTINGS: SpeechSettings = {
  rate: 1.0,
  pitch: 1.0,
  autoReadFlashcards: false,
  lang: 'es-ES'
};

class SpeechService {
  private settings: SpeechSettings = DEFAULT_SETTINGS;
  private voices: SpeechSynthesisVoice[] = [];
  private recognitionInstance: any = null;
  private isCurrentlyDictating = false;
  private listeners: Array<() => void> = [];

  constructor() {
    this.loadSettings();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.populateVoices(false);
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => this.populateVoices(true);
      }
    }
  }

  private loadSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  private saveSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {}
  }

  private populateVoices(notify = true): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    this.voices = window.speechSynthesis.getVoices() || [];
    if (notify) {
      this.notifyListeners();
    }
  }

  public subscribe(callback: () => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch {}
    }
  }

  public isSpeechSynthesisSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  public isSpeechRecognitionSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  public getSettings(): SpeechSettings {
    return { ...this.settings };
  }

  public updateSettings(updates: Partial<SpeechSettings>): SpeechSettings {
    this.settings = { ...this.settings, ...updates };
    this.saveSettings();
    this.notifyListeners();
    return { ...this.settings };
  }

  public getAvailableVoices(): SpeechSynthesisVoice[] {
    if (this.voices.length === 0 && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.populateVoices(false);
    }
    return this.voices;
  }

  /**
   * Lee un texto en voz alta con la voz y velocidad configuradas.
   */
  public speak(text: string, onEnd?: () => void, onError?: (err: any) => void): void {
    if (!this.isSpeechSynthesisSupported()) {
      onError?.(new Error('La síntesis de voz no está soportada en este navegador.'));
      return;
    }

    const cleanText = text.replace(/<[^>]*>/g, '').trim();
    if (!cleanText) {
      onEnd?.();
      return;
    }

    // Detener cualquier lectura previa en curso
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = Math.max(0.5, Math.min(2.0, this.settings.rate || 1.0));
    utterance.pitch = Math.max(0.5, Math.min(1.5, this.settings.pitch || 1.0));
    utterance.lang = this.settings.lang || 'es-ES';

    if (this.settings.voiceUri) {
      const selectedVoice = this.getAvailableVoices().find(v => v.voiceURI === this.settings.voiceUri);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
    } else {
      // Priorizar una voz en español si no se ha elegido ninguna
      const esVoice = this.getAvailableVoices().find(v => v.lang.startsWith('es'));
      if (esVoice) utterance.voice = esVoice;
    }

    utterance.onend = () => {
      onEnd?.();
    };

    utterance.onerror = (e) => {
      // Si fue cancelado intencionalmente por un stopSpeaking, no reportar como error fatal
      if (e.error === 'canceled' || e.error === 'interrupted') {
        onEnd?.();
      } else {
        onError?.(e);
      }
    };

    window.speechSynthesis.speak(utterance);
  }

  /**
   * Detiene inmediatamente cualquier lectura de voz en curso.
   */
  public stopSpeaking(): void {
    if (this.isSpeechSynthesisSupported()) {
      window.speechSynthesis.cancel();
    }
  }

  public isSpeaking(): boolean {
    if (!this.isSpeechSynthesisSupported()) return false;
    return window.speechSynthesis.speaking;
  }

  /**
   * Inicia el reconocimiento de voz continuo en tiempo real.
   */
  public startDictation(
    onTranscript: (text: string, isFinal: boolean) => void,
    onError?: (errorMsg: string) => void
  ): boolean {
    if (!this.isSpeechRecognitionSupported()) {
      onError?.('El reconocimiento de voz no está soportado en este navegador.');
      return false;
    }

    this.stopDictation();

    try {
      const SpeechRecognitionConstructor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognitionConstructor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = this.settings.lang || 'es-ES';

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptChunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcriptChunk;
          } else {
            interimTranscript += transcriptChunk;
          }
        }

        if (finalTranscript) {
          onTranscript(finalTranscript, true);
        } else if (interimTranscript) {
          onTranscript(interimTranscript, false);
        }
      };

      recognition.onerror = (event: any) => {
        let msg = 'Error en el reconocimiento de voz';
        if (event.error === 'not-allowed') {
          msg = 'Permiso de micrófono denegado en el navegador.';
        } else if (event.error === 'no-speech') {
          return; // Silencio ignorado
        } else if (event.error === 'network') {
          msg = 'El reconocimiento por voz del navegador no pudo procesar el audio.';
        }
        onError?.(msg);
      };

      recognition.onend = () => {
        this.isCurrentlyDictating = false;
        this.notifyListeners();
      };

      recognition.start();
      this.recognitionInstance = recognition;
      this.isCurrentlyDictating = true;
      this.notifyListeners();
      return true;
    } catch (err: any) {
      this.isCurrentlyDictating = false;
      onError?.(err?.message || 'No se pudo iniciar el micrófono');
      return false;
    }
  }

  /**
   * Detiene el dictado de voz activo.
   */
  public stopDictation(): void {
    if (this.recognitionInstance) {
      try {
        this.recognitionInstance.stop();
      } catch {}
      this.recognitionInstance = null;
    }
    this.isCurrentlyDictating = false;
    this.notifyListeners();
  }

  public isDictating(): boolean {
    return this.isCurrentlyDictating;
  }
}

export const speechService = new SpeechService();
