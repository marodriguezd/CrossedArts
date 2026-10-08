import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Upload, Plus, Trash2, Image as ImageIcon, Eye, Layers, Check, AlertCircle } from 'lucide-react';
import type { ImageOcclusionData, OcclusionMask } from '../../types/models.ts';
import { dao } from '../../db/dao.ts';
import { Button, cn } from '../ui/index.tsx';

interface ImageOcclusionEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onCardSaved: (cardId: string) => void;
  resourceId?: string;
  lessonId?: string;
}

interface DragBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export const ImageOcclusionEditor: React.FC<ImageOcclusionEditorProps> = ({
  isOpen,
  onClose,
  onCardSaved,
  resourceId,
  lessonId
}) => {
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<'hide_all_reveal_one' | 'hide_one_reveal_one'>('hide_all_reveal_one');
  const [masks, setMasks] = useState<OcclusionMask[]>([]);
  const [selectedMaskId, setSelectedMaskId] = useState<string | null>(null);
  const [dragBox, setDragBox] = useState<DragBox | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Procesar archivo de imagen
  const handleProcessImage = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      setErrorMsg('Por favor selecciona un archivo de imagen válido (PNG, JPG, WebP, SVG).');
      return;
    }
    setErrorMsg(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setImageDataUrl(result);
      if (!front) {
        setFront(`Identifica los elementos: ${file.name.replace(/\.[^/.]+$/, '')}`);
      }
    };
    reader.readAsDataURL(file);
  }, [front]);

  // Soporte de pegado desde portapapeles (Ctrl+V)
  useEffect(() => {
    if (!isOpen) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            handleProcessImage(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen, handleProcessImage]);

  // Manejador Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Coordenadas relativas dentro del contenedor de la imagen (0..100)
  const getRelativeCoordinates = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    return { x, y };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!imageDataUrl) return;
    // Si se hizo clic directamente en un botón o input, no iniciar nuevo dibujo
    if ((e.target as HTMLElement).closest('button, input')) return;
    const coords = getRelativeCoordinates(e);
    setDragBox({
      startX: coords.x,
      startY: coords.y,
      currentX: coords.x,
      currentY: coords.y
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragBox) return;
    const coords = getRelativeCoordinates(e);
    setDragBox(prev => prev ? { ...prev, currentX: coords.x, currentY: coords.y } : null);
  };

  const handleMouseUp = () => {
    if (!dragBox) return;
    const minX = Math.min(dragBox.startX, dragBox.currentX);
    const minY = Math.min(dragBox.startY, dragBox.currentY);
    const width = Math.abs(dragBox.currentX - dragBox.startX);
    const height = Math.abs(dragBox.currentY - dragBox.startY);

    // Ignorar clics mínimos accidentales (< 2% de ancho o alto)
    if (width >= 2 && height >= 2) {
      const newMask: OcclusionMask = {
        id: `mask_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        x: Math.round(minX * 100) / 100,
        y: Math.round(minY * 100) / 100,
        width: Math.round(width * 100) / 100,
        height: Math.round(height * 100) / 100,
        label: `Elemento ${masks.length + 1}`,
        orderIndex: masks.length + 1
      };
      setMasks(prev => [...prev, newMask]);
      setSelectedMaskId(newMask.id);
    }
    setDragBox(null);
  };

  const handleDeleteMask = (id: string) => {
    setMasks(prev => prev.filter(m => m.id !== id));
    if (selectedMaskId === id) setSelectedMaskId(null);
  };

  const handleUpdateMaskLabel = (id: string, label: string) => {
    setMasks(prev => prev.map(m => m.id === id ? { ...m, label } : m));
  };

  const handleSave = async () => {
    if (!imageDataUrl) {
      setErrorMsg('Debes añadir una imagen para crear la tarjeta de oclusión.');
      return;
    }
    if (masks.length === 0) {
      setErrorMsg('Debes dibujar al menos un área de oclusión sobre la imagen.');
      return;
    }
    if (!front.trim()) {
      setErrorMsg('El título / anverso de la tarjeta no puede estar vacío.');
      return;
    }

    setIsSaving(true);
    setErrorMsg(null);

    try {
      // Guardar asset de imagen
      const mediaId = await dao.saveMediaAsset({
        mime_type: imageDataUrl.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/png',
        data: imageDataUrl
      });

      const occlusionData: ImageOcclusionData = {
        imageId: mediaId,
        imageUrl: imageDataUrl,
        mode,
        masks
      };

      const labelsSummary = masks.map((m, i) => `${i + 1}. ${m.label || 'Sin etiqueta'}`).join('\n');
      const finalBack = back.trim() ? `${back.trim()}\n\n---\n${labelsSummary}` : labelsSummary;

      const res = await dao.createFlashcard({
        resource_id: resourceId,
        lesson_id: lessonId,
        front: front.trim(),
        back: finalBack,
        card_type: 'image_occlusion',
        extra_data: JSON.stringify(occlusionData)
      });

      if (!res.success || !res.id) {
        throw new Error(res.error || 'No se pudo guardar la tarjeta');
      }

      onCardSaved(res.id);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al guardar la tarjeta de oclusión');
    } finally {
      setIsSaving(false);
    }
  };

  // Rectángulo temporal de arrastre
  const getTempBoxStyle = () => {
    if (!dragBox) return null;
    const minX = Math.min(dragBox.startX, dragBox.currentX);
    const minY = Math.min(dragBox.startY, dragBox.currentY);
    const width = Math.abs(dragBox.currentX - dragBox.startX);
    const height = Math.abs(dragBox.currentY - dragBox.startY);
    return {
      left: `${minX}%`,
      top: `${minY}%`,
      width: `${width}%`,
      height: `${height}%`
    };
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="occlusion-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
    >
      <div className="relative flex flex-col w-full max-w-5xl max-h-[90vh] rounded-2xl border border-[var(--c-border)] bg-[var(--c-canvas)] text-[var(--c-ink)] shadow-2xl overflow-hidden">
        
        {/* Cabecera */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--c-border)] bg-[var(--c-canvas-subtle)]">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-[var(--c-accent)]/15 text-[var(--c-accent)]">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 id="occlusion-editor-title" className="text-base font-semibold">
                Crear Tarjeta de Oclusión de Imagen
              </h2>
              <p className="text-xs text-[var(--c-ink-muted)]">
                Pega (Ctrl+V) o arrastra una imagen, dibuja rectángulos y define las respuestas.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--c-ink-muted)] hover:bg-[var(--c-canvas-inset)] hover:text-[var(--c-ink)] cursor-pointer"
            aria-label="Cerrar editor"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mensaje de error */}
        {errorMsg && (
          <div className="mx-6 mt-4 p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Cuerpo con 2 columnas */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 overflow-y-auto">
          
          {/* Columna Izquierda: Lienzo de Imagen y Dibujo (7 cols) */}
          <div className="lg:col-span-7 flex flex-col items-center justify-center">
            {imageDataUrl ? (
              <div className="flex flex-col items-center w-full">
                <div
                  ref={containerRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  className="relative inline-block max-w-full overflow-hidden rounded-xl border-2 border-[var(--c-border)] bg-[var(--c-canvas-subtle)] shadow-inner cursor-crosshair select-none"
                >
                  <img
                    src={imageDataUrl}
                    alt="Lienzo de oclusión"
                    className="block max-h-[50vh] max-w-full object-contain pointer-events-none"
                  />

                  {/* Rectángulo en dibujo */}
                  {dragBox && (
                    <div
                      style={getTempBoxStyle()!}
                      className="absolute border-2 border-[var(--c-accent)] bg-[var(--c-accent)]/30 rounded pointer-events-none"
                    />
                  )}

                  {/* Máscaras existentes */}
                  {masks.map((mask, idx) => {
                    const isSelected = mask.id === selectedMaskId;
                    return (
                      <div
                        key={mask.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMaskId(mask.id);
                        }}
                        style={{
                          left: `${mask.x}%`,
                          top: `${mask.y}%`,
                          width: `${mask.width}%`,
                          height: `${mask.height}%`
                        }}
                        className={cn(
                          'absolute rounded flex items-center justify-center cursor-pointer transition-all border-2 text-xs font-bold',
                          isSelected
                            ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/40 shadow-lg ring-2 ring-[var(--c-accent)]/50 text-[var(--c-accent-contrast)]'
                            : 'border-[var(--c-border-strong,var(--c-border))] bg-[var(--c-canvas-inset)]/80 text-[var(--c-ink)] hover:bg-[var(--c-canvas-inset)]'
                        )}
                      >
                        <span className="px-1.5 py-0.5 rounded bg-[var(--c-canvas)]/85 text-[11px] truncate max-w-[90%]">
                          {idx + 1}. {mask.label}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-2 flex items-center justify-between w-full text-xs text-[var(--c-ink-faint)]">
                  <span>Arrastra el ratón sobre la imagen para crear una nueva máscara</span>
                  <button
                    type="button"
                    onClick={() => {
                      setImageDataUrl(null);
                      setMasks([]);
                      setSelectedMaskId(null);
                    }}
                    className="text-red-500 hover:underline cursor-pointer"
                  >
                    Cambiar imagen
                  </button>
                </div>
              </div>
            ) : (
              /* Dropzone para cargar imagen */
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleProcessImage(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center w-full h-80 rounded-2xl border-2 border-dashed border-[var(--c-border)] hover:border-[var(--c-accent)] bg-[var(--c-canvas-subtle)]/50 hover:bg-[var(--c-canvas-subtle)] transition-all cursor-pointer p-6 text-center"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleProcessImage(file);
                  }}
                />
                <div className="p-4 rounded-full bg-[var(--c-canvas-inset)] text-[var(--c-accent)] mb-3 shadow-xs">
                  <Upload className="w-8 h-8" />
                </div>
                <p className="text-sm font-semibold text-[var(--c-ink)]">
                  Arrastra una imagen aquí o haz clic para seleccionarla
                </p>
                <p className="text-xs text-[var(--c-ink-muted)] mt-1">
                  También puedes presionar <kbd className="px-1.5 py-0.5 rounded border border-[var(--c-border)] bg-[var(--c-canvas)] font-mono text-[10px]">Ctrl+V</kbd> para pegar desde el portapapeles
                </p>
              </div>
            )}
          </div>

          {/* Columna Derecha: Parámetros y Lista de Máscaras (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            
            {/* Título / Anverso */}
            <div>
              <label className="block text-xs font-semibold text-[var(--c-ink)] mb-1">
                Pregunta o Título del Anverso *
              </label>
              <input
                type="text"
                value={front}
                onChange={(e) => setFront(e.target.value)}
                placeholder="Ej. Identifica las partes señaladas"
                className="w-full px-3 py-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-canvas)] text-xs text-[var(--c-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)]"
              />
            </div>

            {/* Modo de Repaso */}
            <div>
              <label className="block text-xs font-semibold text-[var(--c-ink)] mb-1">
                Modo de Revelación SM-2
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode('hide_all_reveal_one')}
                  className={cn(
                    'p-2.5 rounded-lg border text-left text-xs transition-all cursor-pointer',
                    mode === 'hide_all_reveal_one'
                      ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/10 font-semibold text-[var(--c-accent)]'
                      : 'border-[var(--c-border)] bg-[var(--c-canvas-subtle)] text-[var(--c-ink-muted)]'
                  )}
                >
                  <p className="font-semibold text-xs">Ocultar todos</p>
                  <p className="text-[10px] opacity-80 mt-0.5">Tapa todas las áreas y destapa la activa.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('hide_one_reveal_one')}
                  className={cn(
                    'p-2.5 rounded-lg border text-left text-xs transition-all cursor-pointer',
                    mode === 'hide_one_reveal_one'
                      ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/10 font-semibold text-[var(--c-accent)]'
                      : 'border-[var(--c-border)] bg-[var(--c-canvas-subtle)] text-[var(--c-ink-muted)]'
                  )}
                >
                  <p className="font-semibold text-xs">Ocultar uno</p>
                  <p className="text-[10px] opacity-80 mt-0.5">Tapa solo el área activa dejando contexto.</p>
                </button>
              </div>
            </div>

            {/* Lista de Máscaras */}
            <div className="flex-1 flex flex-col min-h-[160px]">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-[var(--c-ink)]">
                  Áreas de Oclusión ({masks.length})
                </label>
                {masks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMasks([])}
                    className="text-[11px] text-red-500 hover:underline cursor-pointer"
                  >
                    Borrar todas
                  </button>
                )}
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto max-h-56 pr-1">
                {masks.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed border-[var(--c-border)] text-center text-xs text-[var(--c-ink-faint)]">
                    No hay máscaras creadas todavía. Arrastra sobre la imagen para añadir una.
                  </div>
                ) : (
                  masks.map((mask, idx) => (
                    <div
                      key={mask.id}
                      onClick={() => setSelectedMaskId(mask.id)}
                      className={cn(
                        'flex items-center gap-2 p-2 rounded-lg border transition-all',
                        selectedMaskId === mask.id
                          ? 'border-[var(--c-accent)] bg-[var(--c-accent)]/5'
                          : 'border-[var(--c-border)] bg-[var(--c-canvas-subtle)]'
                      )}
                    >
                      <span className="w-5 h-5 flex items-center justify-center rounded-full bg-[var(--c-canvas-inset)] text-[10px] font-bold text-[var(--c-ink)] shrink-0">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={mask.label || ''}
                        onChange={(e) => handleUpdateMaskLabel(mask.id, e.target.value)}
                        placeholder={`Respuesta ${idx + 1}`}
                        className="flex-1 px-2 py-1 rounded border border-[var(--c-border)] bg-[var(--c-canvas)] text-xs text-[var(--c-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--c-accent)]"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteMask(mask.id);
                        }}
                        className="p-1 rounded text-[var(--c-ink-faint)] hover:text-red-500 cursor-pointer"
                        aria-label={`Eliminar máscara ${idx + 1}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Notas opcionales de reverso */}
            <div>
              <label className="block text-xs font-semibold text-[var(--c-ink)] mb-1">
                Notas adicionales de explicación (opcional)
              </label>
              <textarea
                value={back}
                onChange={(e) => setBack(e.target.value)}
                rows={2}
                placeholder="Contexto adicional que aparecerá al calificar la tarjeta..."
                className="w-full px-3 py-1.5 rounded-lg border border-[var(--c-border)] bg-[var(--c-canvas)] text-xs text-[var(--c-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--c-accent)] resize-none"
              />
            </div>
          </div>
        </div>

        {/* Pie de acciones */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--c-border)] bg-[var(--c-canvas-subtle)]">
          <Button variant="quiet" size="sm" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>

          <Button
            variant="solid"
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !imageDataUrl || masks.length === 0 || !front.trim()}
          >
            {isSaving ? 'Guardando...' : `Guardar Tarjeta (${masks.length} máscaras)`}
          </Button>
        </div>
      </div>
    </div>
  );
};
