export type RuntimeBackend = 'webgpu' | 'wasm' | 'none';

export type RuntimeStatus =
  | 'disabled'
  | 'checking'
  | 'unsupported'
  | 'idle'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'error'
  | 'unloading';

export interface RuntimeLoadingProgress {
  progress: number;
  text: string;
  timeElapsed?: number;
}

export type RuntimeProgressCallback = (progress: RuntimeLoadingProgress) => void;

export interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /**
   * Callback de streaming.
   *
   * CONTRATO DE STREAMING (único para todos los backends): cada invocación
   * entrega un DELTA, es decir SOLO el texto nuevo. Nunca el texto acumulado ni
   * la respuesta final completa. Por tanto:
   *
   *   chunks.join('') === respuesta final
   *
   * Los backends que producen texto acumulado por naturaleza (Transformers.js
   * en WASM, tanto en hilo principal como en worker) calculan el delta ANTES de
   * invocar el callback, y la respuesta final NO se emite una segunda vez.
   * Los backends que ya emiten deltas (WebGPU) los delivers tal cual.
   */
  onChunk?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Abstracción de Runtime de Modelo Local (WebLLM, Transformers.js WASM, WebGPU).
 *
 * Contrato único: `generate()` es el nombre canónico de la API de generación. Los
 * nombres históricos (`generateChat`) existen solo como alias delgado para no
 * romper llamantes externos: no son un segundo contrato.
 */
export interface LocalModelRuntime {
  loadModel(modelId: string, onProgress?: RuntimeProgressCallback): Promise<void>;
  unload(): Promise<void>;
  /** API canónica de generación. Devuelve SIEMPRE el texto final completo. */
  generate(messages: ChatMessage[], options?: GenerationOptions): Promise<string>;
  /**
   * Alias de compatibilidad de `generate`. Mismo comportamiento, incluido el
   * contrato de streaming por deltas.
   */
  generateChat?(
    messages: ChatMessage[],
    options?: GenerationOptions & { stream?: boolean }
  ): Promise<string>;
  /** Iterador de deltas (mismo contrato que `onChunk`). */
  generateStream?(messages: ChatMessage[], options?: GenerationOptions): AsyncIterable<string>;
  getStatus(): RuntimeStatus;
  getLoadedModelId(): string | null;
  getBackend(): RuntimeBackend;
  getLastError(): string | null;
  getProgress(): RuntimeLoadingProgress;
  subscribe(listener: (status: RuntimeStatus, progress: RuntimeLoadingProgress) => void): () => void;
}

/**
 * Emisor de deltas para backends que solo saben producir texto ACUMULADO.
 *
 * Convierte una secuencia de instantáneas acumuladas en deltas reales y
 * garantiza que la concatenación de todo lo emitido reproduce exactamente el
 * texto final (una vez normalizado). Si el texto acumulado se "corrige" (el
 * backend reescribe el final), el emisor emite únicamente el sufijo que aún no
 * había entregado y descarta el prefijo ya emitido, de modo que nunca se
 * duplica ni se pierde contenido.
 *
 * Determinista y sin estado global: cada generación usa su propia instancia.
 */
export class DeltaStream {
  private emitted = '';
  /** Espacio final retenido de la última instantánea. */
  private pendingWhitespace = '';
  private readonly chunks: string[] = [];
  private readonly onChunk: (delta: string) => void;
  private readonly normalize: (text: string) => string;

  constructor(onChunk: (delta: string) => void, normalize?: (text: string) => string) {
    this.onChunk = onChunk;
    // Normalización de MARCADORES, no de espacios: el recorte exterior se aplica
    // una sola vez sobre la respuesta final, no en cada instantánea (si no, un
    // corte de palabra perdería el espacio que lo une con lo siguiente).
    this.normalize = normalize ?? stripTemplateMarkers;
  }

  /**
   * Ingesta una instantánea de texto (acumulado o delta) y emite SOLO lo nuevo.
   *
   * El espacio en blanco final de cada instantánea se RETIENE hasta que llega
   * más contenido (o hasta `finish`), de modo que un corte de palabra no obliga
   * a emitir un delTA terminado en espacio que después se recorta: los deltas
   * reconstruyen la respuesta EXACTAMENTE.
   *
   * Es idempotente con el mismo contenido acumulado y nunca emite vacío.
   */
  push(snapshot: string): void {
    const normalized = this.normalize(snapshot);
    if (normalized.length <= this.emitted.length) return;

    if (!normalized.startsWith(this.emitted)) {
      // El backend reescribió el texto ya emitido: se entrega solo el sufijo
      // realmente nuevo, nunca el prefijo duplicado.
      const commonPrefix = commonPrefixLength(normalized, this.emitted);
      this.emitted = normalized;
      this.pendingWhitespace = '';
      this.emit(normalized.slice(commonPrefix));
      return;
    }

    const diff = normalized.slice(this.emitted.length);
    this.emitted = normalized;

    const trailing = diff.length - diff.replace(/\s+$/, '').length;
    if (trailing === diff.length) {
      // Solo espacio: se retiene hasta que llegue contenido real.
      this.pendingWhitespace += diff;
      return;
    }

    const head = this.pendingWhitespace + diff.slice(0, diff.length - trailing);
    this.pendingWhitespace = diff.slice(diff.length - trailing);
    this.emit(head);
  }

  /**
   * Cierra el flujo. Si el texto final normalizado tiene contenido que no se
   * emitió, se entrega como delTA final; en ningún caso se reemite la respuesta
   * completa que ya llegó por deltas. El espacio retenido se descarta porque la
   * respuesta final está normalizada (sin espacios exteriores).
   */
  finish(finalText: string): void {
    this.push(this.normalize(finalText));
    this.pendingWhitespace = '';
  }

  private emit(delta: string): void {
    if (!delta) return;
    this.chunks.push(delta);
    this.onChunk(delta);
  }

  /** Texto reconstruido concatenando los deltas emitidos. */
  get text(): string {
    return this.chunks.join('');
  }
}

/**
 * Elimina los marcadores de fin de plantilla de chat (`<|im_end|>`,
 * `<|endoftext|>`) SIN recortar el espacio exterior: es la normalización que se
 * aplica a cada instantánea durante el streaming.
 */
export function stripTemplateMarkers(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<\|im_end\|>[\s\S]*$/, '')
    .replace(/<\|endoftext\|>[\s\S]*$/, '');
}

/**
 * Normalización de la RESPUESTA FINAL: marcadores de plantilla y recorte del
 * espacio exterior. Es la forma exacta que devuelve `generate()`, de modo que
 * lo emitido por streaming y lo devuelto coinciden.
 */
export function stripGenerationArtifacts(text: string): string {
  return stripTemplateMarkers(text).trim();
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}