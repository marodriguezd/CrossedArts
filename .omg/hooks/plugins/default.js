/**
 * Default OmG Hooks Plugin Scaffold
 * 
 * @param {object} event - El objeto de evento que contiene el contexto de la ejecución.
 * @param {object} sdk - El conjunto de utilidades provistas por el runtime.
 */
function onHookEvent(event, sdk) {
  sdk.log(`[Hook Default] Procesando evento '${event.event}' en el carril '${event.lane}'`);

  // Guardias de seguridad básicas
  if (event.lane === 'P0-safety') {
    // Si hay una violación explícita de seguridad, forzar fail-closed
    if (event.metadata && event.metadata.safety_violation) {
      sdk.log('[Hook Default] [P0-safety] Violación de seguridad detectada. Bloqueando ejecución.');
      return false;
    }
  }

  // Ejemplo de lectura/escritura de estado libre de timestamps volátiles
  const runCount = sdk.state.get('run_count') || 0;
  sdk.state.set('run_count', runCount + 1);

  return true;
}

module.exports = {
  onHookEvent
};
