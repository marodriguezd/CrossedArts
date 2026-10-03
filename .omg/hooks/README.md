# OmG Hooks - DomestiK

Este directorio contiene las especificaciones, adaptadores y plugins para los hooks de ciclo de vida del proyecto.

## Estructura
- `plugins/`: Contiene los scripts y plugins que extienden el comportamiento durante la ejecución de tareas.

## Contrato de Plugin para Adaptadores en Runtime
Cada plugin de hook debe exponer la siguiente firma:

```javascript
onHookEvent(event, sdk)
```

### 1. El Objeto `event`
Contiene la información de contexto del evento disparado:
- `event`: Nombre identificador del evento (e.g. `onTaskStart`, `onTaskSuccess`, `onTaskFailure`).
- `source`: Origen del evento.
- `session_id`: ID de la sesión actual de orquestación.
- `task_id`: ID de la tarea actual.
- `lane`: Carril de ejecución (`P0-safety`, `P1-quality`, `P2-optimization`).
- `subagent`: Subagente involucrado, si aplica.
- `termination_reason`: Razón de término si aplica.
- `metadata`: Metadatos adicionales estructurados.

### 2. El Objeto `sdk`
Ofrece capacidades del runtime para interactuar con la sesión:
- `log(msg)`: Registrar salida de depuración en la consola o bitácora de la tarea.
- `state.get(key)`: Recuperar estado persistido en el hook.
- `state.set(key, value)`: Guardar estado en el hook (evitando variables volátiles o timestamps a menos que sean visibles para el operador).

## Guardias y Políticas de Ejecución
- **Sincronía y Determinismo**: Las transiciones entre lanes se resuelven de manera determinista y simétrica en base al perfil de configuración.
- **Fail-Closed (P0-safety, P1-quality)**: Cualquier falla o violación de política en estos carriles bloquea inmediatamente la continuación del agente.
- **Fail-Open (P2-optimization)**: Las fallas en estas optimizaciones no interrumpen la tarea actual.
- **Re-entrada Prioritaria**: Las continuaciones bloqueadas deben re-ingresar al carril de seguridad (`P0-safety`) antes de ser admitidas en carriles de calidad u optimización.
- **Sin Efectos Secundarios para Worker Sessions**: Para sesiones secundarias/trabajadoras, los hooks de efectos secundarios están estrictamente desactivados para evitar redundancia o corrupción.
- **Turn Outcomes**: El resultado de los hooks terminales se registra exactamente una vez por turno del agente.
