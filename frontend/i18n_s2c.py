"""Bulk i18n step 2c: migrate 5 pages + supporting services. Idempotent-ish.

Run: python3 i18n_s2c.py  (from repo root)
patch(): skips when already applied. rep_all(): replaces all occurrences.
"""
from pathlib import Path

BASE = Path("CrossedArts/frontend/src")
LOCALES = BASE / "i18n/locales"


def patch(path_rel: str, old: str, new: str) -> None:
    p = BASE / path_rel
    src = p.read_text(encoding="utf-8")
    if old not in src:
        assert new in src, f"NEITHER in {path_rel}: {old[:70]!r}"
        print(f"skip {path_rel}: {old[:44]!r}")
        return
    assert src.count(old) == 1, f"MULTIPLE ({src.count(old)}) in {path_rel}: {old[:70]!r}"
    p.write_text(src.replace(old, new), encoding="utf-8")
    print(f"ok {path_rel}: {old[:44]!r}")


def rep_all(path_rel: str, old: str, new: str, expect: int = 0) -> None:
    p = BASE / path_rel
    src = p.read_text(encoding="utf-8")
    n = src.count(old)
    if n == 0:
        assert new in src, f"NEITHER in {path_rel}: {old[:70]!r}"
        print(f"skip {path_rel}: {old[:44]!r}")
        return
    if expect:
        assert n == expect, f"COUNT {n} != {expect} in {path_rel}: {old[:70]!r}"
    p.write_text(src.replace(old, new), encoding="utf-8")
    print(f"ok({n}x) {path_rel}: {old[:44]!r}")


EXTRA_KEYS: list[tuple[str, str, str, str, str, str, str]] = [
 ("goals.page.checkFallback", "Check the goal data.", "Revisa los datos de la meta.", "Pr\u00fcfe die Zieldaten.", "V\u00e9rifie les donn\u00e9es de l\u2019objectif.", "Controlla i dati dell\u2019obiettivo.", "请检查目标数据。"),
]


def add_extra_keys() -> None:
    idx = {"en": 0, "es": 1, "de": 2, "fr": 3, "it": 4, "zh": 5}
    for lang, i in idx.items():
        path = LOCALES / f"{lang}.ts"
        src = path.read_text(encoding="utf-8")
        missing = [(k, t[i]) for k, *t in EXTRA_KEYS if f"'{k}'" not in src]
        if not missing:
            continue
        lines = "".join(f"  '{k}': '{v}',\n" for k, v in missing)
        anchor = "} as const;" if lang == "en" else "};"
        src = src.replace(anchor, lines + anchor)
        path.write_text(src, encoding="utf-8")
        print(f"{lang}: added {len(missing)} extra keys")


def goals_service_fix() -> None:
    # goalUnitLabel must map Spanish unit ids to unit keys.
    patch("services/goals.ts",
"""/** Localized unit label for a goal measure. */
export function goalUnitLabel(unit: GoalUnit, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `goals.unit.${unit}`);
}""",
"""/** Localized unit label for a goal measure. */
const GOAL_UNIT_KEYS: Record<GoalUnit, string> = {
  lecciones: 'lessons',
  p\u00e1ginas: 'pages',
  piezas: 'pieces',
  minutos: 'minutes',
  ninguna: 'none'
};

export function goalUnitLabel(unit: GoalUnit, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `goals.unit.${GOAL_UNIT_KEYS[unit] ?? 'none'}`);
}""")


def domain_logic() -> None:
    patch("services/domainLogic.ts",
"""export function describeDestructiveAction(
  action: DestructiveAction,
  targetLabel: string
): { title: string; consequence: string; confirmLabel: string; reversible: boolean } {""",
"""export function describeDestructiveAction(
  action: DestructiveAction,
  targetLabel: string,
  lang: LanguageCode = 'es'
): { title: string; consequence: string; confirmLabel: string; reversible: boolean } {
  const tr = (key: string, params?: Record<string, string | number | null | undefined>): string =>
    translateKey(lang, key, params);""")
    patch("services/domainLogic.ts",
"""    case 'delete-course':
      return {
        title: 'Eliminar curso',
        consequence: `Se eliminar\u00e1 "${targetLabel}" junto con sus m\u00f3dulos y lecciones. Las notas y tarjetas asociadas se conservar\u00e1n, pero perder\u00e1n su v\u00ednculo con el curso. Esta acci\u00f3n no se puede deshacer.`,
        confirmLabel: 'Eliminar curso',
        reversible: false
      };""",
"""    case 'delete-course':
      return {
        title: tr('destroy.courseT'),
        consequence: tr('destroy.courseC', { label: targetLabel }),
        confirmLabel: tr('destroy.courseOk'),
        reversible: false
      };""")
    patch("services/domainLogic.ts",
"""    case 'delete-module':
      return {
        title: 'Eliminar m\u00f3dulo',
        consequence: `Se eliminar\u00e1 "${targetLabel}" y todas sus lecciones. Las notas asociadas se conservar\u00e1n. Esta acci\u00f3n no se puede deshacer.`,
        confirmLabel: 'Eliminar m\u00f3dulo',
        reversible: false
      };""",
"""    case 'delete-module':
      return {
        title: tr('destroy.moduleT'),
        consequence: tr('destroy.moduleC', { label: targetLabel }),
        confirmLabel: tr('destroy.moduleOk'),
        reversible: false
      };""")
    patch("services/domainLogic.ts",
"""    case 'delete-lesson':
      return {
        title: 'Eliminar lecci\u00f3n',
        consequence: `Se eliminar\u00e1 "${targetLabel}". Las notas asociadas se conservar\u00e1n, pero perder\u00e1n su v\u00ednculo con la lecci\u00f3n. Esta acci\u00f3n no se puede deshacer.`,
        confirmLabel: 'Eliminar lecci\u00f3n',
        reversible: false
      };""",
"""    case 'delete-lesson':
      return {
        title: tr('destroy.lessonT'),
        consequence: tr('destroy.lessonC', { label: targetLabel }),
        confirmLabel: tr('destroy.lessonOk'),
        reversible: false
      };""")
    patch("services/domainLogic.ts",
"""    case 'delete-connection':
    default:
      return {
        title: 'Eliminar conexi\u00f3n',
        consequence: `Se eliminar\u00e1 la relaci\u00f3n "${targetLabel}" entre ambos recursos. Solo la relaci\u00f3n se borra; los recursos no se modifican. Esta acci\u00f3n no se puede deshacer.`,
        confirmLabel: 'Eliminar conexi\u00f3n',
        reversible: false
      };""",
"""    case 'delete-connection':
    default:
      return {
        title: tr('destroy.connT'),
        consequence: tr('destroy.connC', { label: targetLabel }),
        confirmLabel: tr('destroy.connOk'),
        reversible: false
      };""")
    # validateKnowledgeConnection
    patch("services/domainLogic.ts",
"""export function validateKnowledgeConnection(
  candidate: KnowledgeConnectionCandidate,
  context: KnowledgeConnectionValidationContext
): KnowledgeConnectionValidationResult {""",
"""export function validateKnowledgeConnection(
  candidate: KnowledgeConnectionCandidate,
  context: KnowledgeConnectionValidationContext,
  lang: LanguageCode = 'es'
): KnowledgeConnectionValidationResult {""")
    patch("services/domainLogic.ts",
"    return { valid: false, error: `Tipo de relaci\u00f3n no soportado: \"${candidate.relationType}\".` };",
"    return { valid: false, error: translateKey(lang, 'conn.err.badRel', { rel: candidate.relationType }) };")
    patch("services/domainLogic.ts",
"    return { valid: false, error: 'Debes seleccionar un origen y un destino v\u00e1lidos.' };",
"    return { valid: false, error: translateKey(lang, 'conn.err.needBoth') };")
    patch("services/domainLogic.ts",
"    return { valid: false, error: 'El origen y el destino no pueden ser el mismo recurso.' };",
"    return { valid: false, error: translateKey(lang, 'conn.err.sameNode') };")
    patch("services/domainLogic.ts",
"    return { valid: false, error: 'El recurso de origen no existe en el grafo local.' };",
"    return { valid: false, error: translateKey(lang, 'conn.err.noSource') };")
    patch("services/domainLogic.ts",
"    return { valid: false, error: 'El recurso de destino no existe en el grafo local.' };",
"    return { valid: false, error: translateKey(lang, 'conn.err.noTarget') };")
    patch("services/domainLogic.ts",
"    return { valid: false, error: 'Esta conexi\u00f3n ya existe.' };",
"    return { valid: false, error: translateKey(lang, 'conn.err.dup') };")
    # calculateBookProgress
    patch("services/domainLogic.ts",
"export function calculateBookProgress(\n  currentPage: number,\n  totalPages: number\n): BookProgressResult {",
"export function calculateBookProgress(\n  currentPage: number,\n  totalPages: number,\n  lang: LanguageCode = 'es'\n): BookProgressResult {")
    patch("services/domainLogic.ts",
"    return { valid: false, error: 'El libro no tiene un n\u00famero total de p\u00e1ginas v\u00e1lido configurado.' };",
"    return { valid: false, error: translateKey(lang, 'book.err.noTotal') };")
    patch("services/domainLogic.ts",
"    return { valid: false, error: 'La p\u00e1gina indicada debe ser un n\u00famero v\u00e1lido.' };",
"    return { valid: false, error: translateKey(lang, 'book.err.badPage') };")
    # formatNextReviewInterval
    patch("services/domainLogic.ts",
"""export function formatNextReviewInterval(intervalDays: number): string {
  const days = Math.max(1, Math.round(intervalDays));
  if (days === 1) return '1 d\u00eda';
  if (days < 30) return `${days} d\u00edas`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 mes' : `${months} meses`;
}""",
"""export function formatNextReviewInterval(intervalDays: number, lang: LanguageCode = 'es'): string {
  const days = Math.max(1, Math.round(intervalDays));
  if (days === 1) return translateKey(lang, 'review.interval.day');
  if (days < 30) return translateKey(lang, 'review.interval.days', { n: days });
  const months = Math.round(days / 30);
  return months === 1
    ? translateKey(lang, 'review.interval.month')
    : translateKey(lang, 'review.interval.months', { n: months });
}""")
    # generateDailyActivitySeries month names
    patch("services/domainLogic.ts",
"""export function generateDailyActivitySeries(
  history: Array<{ date: string; minutes: number; reviews: number }>,
  range: TimeRangeFilter,
  todayStr: string
): DailyActivityPoint[] {""",
"""export function generateDailyActivitySeries(
  history: Array<{ date: string; minutes: number; reviews: number }>,
  range: TimeRangeFilter,
  todayStr: string,
  lang: LanguageCode = 'es'
): DailyActivityPoint[] {""")
    patch("services/domainLogic.ts",
"""    const monthNames: Record<string, string> = {
      '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr', '05': 'May', '06': 'Jun',
      '07': 'Jul', '08': 'Ago', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic'
    };""",
"""    const monthNames: Record<string, string> = {
      '01': translateKey(lang, 'chart.month.01'), '02': translateKey(lang, 'chart.month.02'),
      '03': translateKey(lang, 'chart.month.03'), '04': translateKey(lang, 'chart.month.04'),
      '05': translateKey(lang, 'chart.month.05'), '06': translateKey(lang, 'chart.month.06'),
      '07': translateKey(lang, 'chart.month.07'), '08': translateKey(lang, 'chart.month.08'),
      '09': translateKey(lang, 'chart.month.09'), '10': translateKey(lang, 'chart.month.10'),
      '11': translateKey(lang, 'chart.month.11'), '12': translateKey(lang, 'chart.month.12')
    };""")
    # markdown exports
    patch("services/domainLogic.ts",
"export function exportNoteToMarkdown(note: Note, contextInfo?: { resourceTitle?: string; lessonTitle?: string }): string {",
"export function exportNoteToMarkdown(note: Note, contextInfo?: { resourceTitle?: string; lessonTitle?: string }, lang: LanguageCode = 'es'): string {")
    patch("services/domainLogic.ts",
"  lines.push(`*Exportado localmente desde CrossedArts el ${new Date().toISOString().slice(0, 10)}*`);",
"  lines.push(`*${translateKey(lang, 'export.md.footer', { date: new Date().toISOString().slice(0, 10) })}*`);")
    patch("services/domainLogic.ts",
"export function exportNotesToSingleMarkdown(notes: Note[]): string {",
"export function exportNotesToSingleMarkdown(notes: Note[], lang: LanguageCode = 'es'): string {")
    patch("services/domainLogic.ts",
"  lines.push('# Cuaderno de Estudio \u2014 CrossedArts');",
"  lines.push(`# ${translateKey(lang, 'export.md.notebook')}`);")
    patch("services/domainLogic.ts",
"  lines.push(`*Colecci\u00f3n de ${notes.length} notas de estudio exportadas el ${new Date().toISOString().slice(0, 10)}*`);",
"  lines.push(`*${translateKey(lang, 'export.md.notebookSub', { n: notes.length, date: new Date().toISOString().slice(0, 10) })}*`);")
    patch("services/domainLogic.ts",
"      if (note.created_at) metaParts.push(`**Fecha:** ${note.created_at.slice(0, 10)}`);",
"      if (note.created_at) metaParts.push(translateKey(lang, 'export.md.metaDate', { date: note.created_at.slice(0, 10) }));")
    patch("services/domainLogic.ts",
"      if (note.tags) metaParts.push(`**Etiquetas:** \\`${note.tags}\\``);",
"      if (note.tags) metaParts.push(translateKey(lang, 'export.md.metaTags', { tags: note.tags }));")


def graph_exploration() -> None:
    patch("services/graphExploration.ts",
"export function buildGraphInsights(analytics: GraphAnalytics): string[] {",
"export function buildGraphInsights(analytics: GraphAnalytics, lang: LanguageCode = 'es'): string[] {")
    patch("services/graphExploration.ts",
"    return ['El grafo est\u00e1 vac\u00edo: todav\u00eda no hay nodos que analizar.'];",
"    return [translateKey(lang, 'graph.insight.empty')];")
    patch("services/graphExploration.ts",
"""      analytics.isolatedNodes === 1
        ? '1 nodo no tiene ninguna relaci\u00f3n.'
        : `${analytics.isolatedNodes} nodos no tienen ninguna relaci\u00f3n.`""",
"""      analytics.isolatedNodes === 1
        ? translateKey(lang, 'graph.insight.isolatedOne')
        : translateKey(lang, 'graph.insight.isolatedOther', { n: analytics.isolatedNodes })""")
    patch("services/graphExploration.ts",
"      `El grafo tiene ${analytics.components.count} grupos sin conexi\u00f3n entre s\u00ed (el mayor re\u00fane ${analytics.components.largestSize} nodos).`",
"      translateKey(lang, 'graph.insight.groups', { n: analytics.components.count, m: analytics.components.largestSize })")
    patch("services/graphExploration.ts",
"      `${analytics.weakResources.length} ${analytics.weakResources.length === 1 ? 'recurso est\u00e1 poco conectado' : 'recursos est\u00e1n poco conectados'} (una sola conexi\u00f3n o ninguna).`",
"      translateKey(lang, `graph.insight.${analytics.weakResources.length === 1 ? 'weakOne' : 'weakOther'}`, { n: analytics.weakResources.length })")
    patch("services/graphExploration.ts",
"    insights.push(`\u00ab${most.name}\u00bb es el nodo con m\u00e1s conexiones (${most.degree}).`);",
"    insights.push(translateKey(lang, 'graph.insight.topMost', { name: most.name, n: most.degree }));")
    patch("services/graphExploration.ts",
"      `${analytics.highDegree.length} ${analytics.highDegree.length === 1 ? 'nodo tiene' : 'nodos tienen'} un n\u00famero de conexiones inusualmente alto (grado \u2265 ${analytics.highDegreeThreshold}).`",
"      translateKey(lang, `graph.insight.${analytics.highDegree.length === 1 ? 'hubOne' : 'hubOther'}`, { n: analytics.highDegree.length, t: analytics.highDegreeThreshold })")
    patch("services/graphExploration.ts",
"    insights.push(`Actividad reciente: ${analytics.recent.length} elementos con cambios el ${analytics.recent[0].date} o despu\u00e9s.`);",
"    insights.push(translateKey(lang, 'graph.insight.recentAct', { n: analytics.recent.length, date: analytics.recent[0].date }));")


def speech_service() -> None:
    patch("services/speechService.ts",
"export interface SpeechSettings {",
"import { translateKey } from '../i18n/dictionaries.ts';\nimport type { LanguageCode } from '../i18n/languages.ts';\n\nexport interface SpeechSettings {")
    patch("services/speechService.ts",
"  public speak(text: string, onEnd?: () => void, onError?: (err: any) => void): void {\n    if (!this.isSpeechSynthesisSupported()) {\n      onError?.(new Error('La s\u00edntesis de voz no est\u00e1 soportada en este navegador.'));\n      return;\n    }",
"  public speak(text: string, onEnd?: () => void, onError?: (err: any) => void, lang: LanguageCode = 'es'): void {\n    if (!this.isSpeechSynthesisSupported()) {\n      onError?.(new Error(translateKey(lang, 'speech.ttsNo')));\n      return;\n    }")
    patch("services/speechService.ts",
"""  public startDictation(
    onTranscript: (text: string, isFinal: boolean) => void,
    onError?: (errorMsg: string) => void
  ): boolean {
    if (!this.isSpeechRecognitionSupported()) {
      onError?.('El reconocimiento de voz no est\u00e1 soportado en este navegador.');
      return false;
    }""",
"""  public startDictation(
    onTranscript: (text: string, isFinal: boolean) => void,
    onError?: (errorMsg: string) => void,
    lang: LanguageCode = 'es'
  ): boolean {
    if (!this.isSpeechRecognitionSupported()) {
      onError?.(translateKey(lang, 'speech.sttNo'));
      return false;
    }""")
    patch("services/speechService.ts",
"        let msg = 'Error en el reconocimiento de voz';",
"        let msg = translateKey(lang, 'speech.sttErr');")
    patch("services/speechService.ts",
"          msg = 'Permiso de micr\u00f3fono denegado en el navegador.';",
"          msg = translateKey(lang, 'speech.micDenied');")
    patch("services/speechService.ts",
"          msg = 'El reconocimiento por voz del navegador no pudo procesar el audio.';",
"          msg = translateKey(lang, 'speech.sttNet');")
    patch("services/speechService.ts",
"      onError?.(err?.message || 'No se pudo iniciar el micr\u00f3fono');",
"      onError?.(err?.message || translateKey(lang, 'speech.micFail'));")


def analytics_service() -> None:
    patch("services/analytics.ts",
"""export function buildDailySeries(
  sessions: readonly LearningSession[],
  range: AnalyticsRange,
  today: string,
  utcOffset?: string
): DailyActivityPoint[] {""",
"""export function buildDailySeries(
  sessions: readonly LearningSession[],
  range: AnalyticsRange,
  today: string,
  utcOffset?: string,
  lang: LanguageCode = 'es'
): DailyActivityPoint[] {""")
    patch("services/analytics.ts",
"  return generateDailyActivitySeries(history, range, today);",
"  return generateDailyActivitySeries(history, range, today, lang);")


if __name__ == "__main__":
    add_extra_keys()
    goals_service_fix()
    domain_logic()
    graph_exploration()
    speech_service()
    analytics_service()
    print("OK s2c-services")
