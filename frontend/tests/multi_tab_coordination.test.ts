import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Coordinación multi-pestaña: lógica pura y determinista del protocolo.
 *
 * El objetivo NO es resolver conflictos (eso exigiría un CRDT y está
 * explícitamente fuera de alcance). Es un mecanismo local y determinista:
 *
 *   - quien escribe incrementa una revisión monótona y la difunde por
 *     `BroadcastChannel`;
 *   - quien recibe una revisión SUPERIOR a la suya sabe que su estado en memoria
 *     puede estar obsoleto y lo marca;
 *   - antes de la siguiente operación de datos recarga desde IndexedDB.
 *
 * No se pierde ni se pisa nada: la versión de IndexedDB es la que ganó la última
 * escritura, así que siempre es la vencedora. Y como la recarga no vuelve a persistir,
 * no puede entrar en bucle.
 */

/** Estado de coordinación aislado, equivalente al que lleva SQLiteBridge. */
class CoordinationState {
  public persistedRevision = 0;
  public lastSeenRevision = 0;
  public remoteRevision = 0;
  public reloads = 0;
  /** Ids de mensajes que este emulateur debe ignorar (nuestros propios). */
  public readonly selfOrigin: string;

  constructor(selfOrigin: string) {
    this.selfOrigin = selfOrigin;
  }

  /** Aplica un mensaje recibido del canal de coordinación. */
  receive(message: { type: string; revision: number; origin: string }): void {
    if (message.type !== 'DATABASE_MUTATED_ANOTHER_TAB') return;
    if (message.origin === this.selfOrigin) return;
    this.lastSeenRevision = Math.max(this.lastSeenRevision, message.revision);
    if (message.revision > this.persistedRevision) {
      this.remoteRevision = Math.max(this.remoteRevision, message.revision);
    }
  }

  /** ¿Nuestro estado en memoria puede estar obsoleto? */
  isStale(): boolean {
    return this.remoteRevision > this.persistedRevision;
  }

  /** Simula la recarga desde IndexedDB antes de la siguiente lectura. */
  async ensureFresh(bytesAreReadable: boolean): Promise<boolean> {
    if (!this.isStale()) return false;
    // Sin bytes legibles se conserva el estado actual: es preferible servir datos
    // antiguos que perder la sesión por un fallo transitorio de lectura.
    if (!bytesAreReadable) return false;
    const target = this.remoteRevision;
    this.persistedRevision = target;
    this.lastSeenRevision = Math.max(this.lastSeenRevision, target);
    this.remoteRevision = 0;
    this.reloads += 1;
    return true;
  }
}

test('18.1 A peer write marks our in-memory state as stale until we reload', async () => {
  const tab = new CoordinationState('tab-a');

  tab.receive({ type: 'DATABASE_MUTATED_ANOTHER_TAB', revision: 5, origin: 'tab-b' });
  assert.ok(tab.isStale(), 'Una revisión remota superior marca el estado como obsoleto');

  const reloaded = await tab.ensureFresh(true);
  assert.equal(reloaded, true, 'Se recarga antes de la siguiente lectura');
  assert.equal(tab.persistedRevision, 5, 'Adoptamos la revisión persistida por la otra pestaña');
  assert.ok(!tab.isStale(), 'Tras recargar ya no estamos obsoletos');
});

test('18.2 Our own messages are ignored (no reload loop)', async () => {
  const tab = new CoordinationState('tab-a');

  // El bridge envía un mensaje por cada persist() propio; si lo tratáramos como
  // remoto entraríamos en un bucle infinito de recarga.
  tab.receive({ type: 'DATABASE_MUTATED_ANOTHER_TAB', revision: 9, origin: 'tab-a' });
  assert.ok(!tab.isStale(), 'Un mensaje propio no puede marcar el estado como obsoleto');
  assert.equal(await tab.ensureFresh(true), false, 'No se recarga por un mensaje propio');
});

test('18.3 Repeated ensureFresh does not reload again once caught up', async () => {
  const tab = new CoordinationState('tab-a');
  tab.receive({ type: 'DATABASE_MUTATED_ANOTHER_TAB', revision: 3, origin: 'tab-b' });

  assert.equal(await tab.ensureFresh(true), true);
  assert.equal(await tab.ensureFresh(true), false, 'La segunda llamada ya no recarga');
  assert.equal(await tab.ensureFresh(true), false);
  assert.equal(tab.reloads, 1, 'Solo se recarga una vez por versión obsoleta');
});

test('18.4 An older remote revision never overwrites newer local state', async () => {
  const tab = new CoordinationState('tab-a');

  // Guardamos localmente hasta la revisión 7.
  tab.persistedRevision = 7;
  tab.receive({ type: 'DATABASE_MUTATED_ANOTHER_TAB', revision: 4, origin: 'tab-b' });

  assert.ok(!tab.isStale(), 'Un mensaje con revisión anterior no invalida estado más nuevo');
  assert.equal(await tab.ensureFresh(true), false, 'No se sobrescribe información más nueva con más antigua');
  assert.equal(tab.persistedRevision, 7, 'Nuestra revisión se conserva');
});

test('18.5 A failed read keeps the current state instead of losing the session', async () => {
  const tab = new CoordinationState('tab-a');
  tab.receive({ type: 'DATABASE_MUTATED_ANOTHER_TAB', revision: 12, origin: 'tab-b' });

  // IndexedDB no se pudo leer: seguimos obsoletos, pero NO se destruye el estado.
  assert.equal(await tab.ensureFresh(false), false);
  assert.equal(tab.reloads, 0, 'No se reemplaza la base de datos con nada');
  assert.equal(tab.persistedRevision, 0, 'El estado en memoria sigue intacto');
  assert.ok(tab.isStale(), 'Seguimos marcados como potencialmente obsoletos para reintentar');

  // Un reintento posterior sí recupera el estado.
  assert.equal(await tab.ensureFresh(true), true);
  assert.equal(tab.persistedRevision, 12);
});

test('18.6 Non-mutation messages are ignored entirely', () => {
  const tab = new CoordinationState('tab-a');
  tab.receive({ type: 'OTRO_TIPO', revision: 99, origin: 'tab-b' });
  assert.ok(!tab.isStale(), 'Solo los mensajes de mutación de la base de datos son relevantes');
});

test('18.7 Reloading never re-broadcasts (guarantees no reload loop end-to-end)', async () => {
  // El bridge real solo difunde mensajes dentro de `persist()`. La recarga por
  // `reloadFromPeerRevision()` no llama a `persist()`, por lo que no genera un
  // nuevo mensaje que dispare otra recarga.
  const source = readFileSync(new URL('../src/db/sqliteBridge.ts', import.meta.url), 'utf8');

  const reloadFn = source.slice(source.indexOf('private async reloadFromPeerRevision'));
  const reloadBody = reloadFn.slice(0, reloadFn.indexOf('\n  }'));

  assert.ok(reloadBody.length > 0, 'Se localiza la función de recarga');
  assert.ok(
    !/this\.persist\(\)/.test(reloadBody),
    'La recarga desde otra pestaña NO debe persistir (si lo hiciera, realimentaría el canal)'
  );
  assert.ok(/loadFromStorage\(\)/.test(reloadBody), 'La recarga lee de IndexedDB');
});