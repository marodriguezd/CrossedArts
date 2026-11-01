/**
 * Registro compartido de overlays abiertos (orden de apertura).
 *
 * Por qué existe: cada overlay del proyecto escuchaba `keydown` en `window` por
 * su cuenta y reaccionaba a Escape sin saber si había otro encima. Con dos
 * abiertos a la vez (p. ej. el cajón de IA y el diálogo de previsualización de
 * Biblioteca, o el cajón y un ConfirmDialog), una sola pulsación de Escape
 * cerraba AMBOS: `preventDefault()` no detiene a los demás listeners, y el
 * orden de invocación es el de registro, no el de apilado. El cajón de IA
 * guarda la conversación en curso, así que cerrarlo sin que el usuario lo pida
 * destruye trabajo visible.
 *
 * Regla: sólo el overlay que está ARRIBA en el registro responde a Escape. Cada
 * overlay se registra al abrirse y se da de baja al cerrarse (o al desmontarse),
 * de modo que el registro siempre refleja lo que hay en pantalla.
 *
 * El registro es un módulo, no estado de React: los overlays cierran y abren a
 * distinta velocidad y necesitan una respuesta inmediata y determinista.
 */

/** Identificador estable por tipo de overlay. */
export type OverlayId =
  | 'command-palette'
  | 'ai-drawer'
  | 'confirm-dialog'
  | 'library-dialogs'
  | 'graph-connection-dialog'
  | 'flashcard-modal'
  | 'occlusion-editor';

/**
 * Una ENTRADA por instancia abierta, en orden de apertura; la última es la de
 * arriba. Se guardan instancias y no tipos únicos a propósito: dos diálogos del
 * mismo tipo pueden convivir (uno anidado en otro) y el que se acaba de abrir
 * es el que está encima, aunque su tipo ya estuviera en la pila.
 */
const stack: OverlayId[] = [];

/** Registra una instancia abierta de ese overlay. */
export function pushOverlay(id: OverlayId): void {
  stack.push(id);
}

/**
 * Da de baja la instancia MÁS RECIENTE de ese overlay: es la que se está
 * cerrando, y con varias anidadas las de abajo siguen vivas.
 */
export function removeOverlay(id: OverlayId): void {
  const index = stack.lastIndexOf(id);
  if (index >= 0) stack.splice(index, 1);
}

/** `true` sólo para el overlay de arriba: el único que debe reaccionar a Escape. */
export function isTopOverlay(id: OverlayId): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** Estado actual (diagnóstico y tests). El array devuelto es una copia. */
export function getOverlayStack(): OverlayId[] {
  return [...stack];
}

/** Vacía el registro. Sólo para tests: en la app se vacía cerrando los overlays. */
export function resetOverlayStack(): void {
  stack.length = 0;
}
