"""Bulk i18n step 2e: DAO/db/service layers + App language propagation.

Run from repo root. patch()/rep_all() imported from i18n_s2c (skip-if-done).
"""
import sys
sys.path.insert(0, 'CrossedArts/frontend')
from pathlib import Path
from i18n_s2c import patch, rep_all

BASE = Path("CrossedArts/frontend/src")
LOCALES = BASE / "i18n/locales"

KEYS: list[tuple[str, str, str, str, str, str, str]] = [
 ("pkg.badFormat", "The package has no valid format: a JSON object was expected.", "El paquete no tiene un formato v\u00e1lido: se esperaba un objeto JSON.", "Das Paket hat kein g\u00fcltiges Format: Ein JSON-Objekt wurde erwartet.", "Le paquet n\u2019a pas un format valide : un objet JSON \u00e9tait attendu.", "Il pacchetto non ha un formato valido: era atteso un oggetto JSON.", "该包格式无效：应为 JSON 对象。"),
 ("pkg.badVersion", "The package declares no valid version.", "El paquete no declara una versi\u00f3n v\u00e1lida.", "Das Paket deklariert keine g\u00fcltige Version.", "Le paquet ne d\u00e9clare aucune version valide.", "Il pacchetto non dichiara una versione valida.", "该包未声明有效版本。"),
 ("pkg.badResource", "The package has no valid resource (id and title are required).", "El paquete no contiene un recurso v\u00e1lido (id y t\u00edtulo son obligatorios).", "Das Paket enth\u00e4lt keine g\u00fcltige Ressource (id und Titel sind erforderlich).", "Le paquet ne contient aucune ressource valide (id et titre requis).", "Il pacchetto non contiene una risorsa valida (id e titolo obbligatori).", "该包没有有效资源（id 和标题为必填）。"),
 ("pkg.empty", "The package was empty.", "El paquete estaba vac\u00edo.", "Das Paket war leer.", "Le paquet \u00e9tait vide.", "Il pacchetto era vuoto.", "该包为空。"),
 ("pkg.nothingNewOne", "There was nothing new to import (1 item already existed).", "No hab\u00eda nada nuevo que importar (1 elemento ya exist\u00eda).", "Es gab nichts Neues zu importieren (1 Element existierte bereits).", "Rien de nouveau \u00e0 importer (1 \u00e9l\u00e9ment existait d\u00e9j\u00e0).", "Niente di nuovo da importare (1 elemento esisteva gi\u00e0).", "没有可导入的新内容（1 个条目已存在）。"),
 ("pkg.nothingNewOther", "There was nothing new to import ({n} items already existed).", "No hab\u00eda nada nuevo que importar ({n} elementos ya exist\u00edan).", "Es gab nichts Neues zu importieren ({n} Elemente existierten bereits).", "Rien de nouveau \u00e0 importer ({n} \u00e9l\u00e9ments existaient d\u00e9j\u00e0).", "Niente di nuovo da importare ({n} elementi esistevano gi\u00e0).", "没有可导入的新内容（{n} 个条目已存在）。"),
 ("pkg.importedOne", "Package imported: 1 new item.", "Paquete importado: 1 elemento nuevo.", "Paket importiert: 1 neues Element.", "Paquet import\u00e9 : 1 nouvel \u00e9l\u00e9ment.", "Pacchetto importato: 1 nuovo elemento.", "已导入该包：1 个新条目。"),
 ("pkg.importedOther", "Package imported: {n} new items.", "Paquete importado: {n} elementos nuevos.", "Paket importiert: {n} neue Elemente.", "Paquet import\u00e9 : {n} nouveaux \u00e9l\u00e9ments.", "Pacchetto importato: {n} nuovi elementi.", "已导入该包：{n} 个新条目。"),
 ("pkg.skipped", " {n} already existed and were skipped.", " {n} ya exist\u00edan y se omitieron.", " {n} existierten bereits und wurden \u00fcbersprungen.", " {n} existaient d\u00e9j\u00e0 et ont \u00e9t\u00e9 ignor\u00e9s.", " {n} esistevano gi\u00e0 e sono stati omessi.", " {n} 个已存在，已跳过。"),
 ("pkg.conflictOneLabel", "1 item already existed", "1 elemento ya exist\u00eda", "1 Element existierte bereits", "1 \u00e9l\u00e9ment existait d\u00e9j\u00e0", "1 elemento esisteva gi\u00e0", "1 个条目已存在"),
 ("pkg.conflictOtherLabel", "{n} items already existed", "{n} elementos ya exist\u00edan", "{n} Elemente existierten bereits", "{n} \u00e9l\u00e9ments existaient d\u00e9j\u00e0", "{n} elementi esistevano gi\u00e0", "{n} 个条目已存在"),
 ("pkg.conflictSuffix", " with different content: your local version was kept and nothing was overwritten.", " con un contenido distinto: se conserv\u00f3 tu versi\u00f3n local y no se sobrescribi\u00f3 nada.", " mit anderem Inhalt: deine lokale Version wurde behalten und nichts wurde \u00fcberschrieben.", " avec un contenu diff\u00e9rent : ta version locale a \u00e9t\u00e9 conserv\u00e9e et rien n\u2019a \u00e9t\u00e9 \u00e9cras\u00e9.", " con un contenuto diverso: la tua versione locale \u00e8 stata conservata e nulla \u00e8 stato sovrascritto.", "内容不同：保留了你的本地版本，未覆盖任何内容。"),
 ("scope.globalLeak", "A global session cannot have a resource or lesson: choose the resource or lesson scope.", "Una sesi\u00f3n global no puede tener recurso ni lecci\u00f3n: elige el \u00e1mbito resource o lesson.", "Eine globale Sitzung darf keine Ressource oder Lektion haben: w\u00e4hle den Bereich resource oder lesson.", "Une session globale ne peut pas avoir de ressource ni de le\u00e7on : choisis la port\u00e9e resource ou lesson.", "Una sessione globale non pu\u00f2 avere risorsa o lezione: scegli l\u2019ambito resource o lesson.", "全局学习不能有关联资源或课时：请选择 resource 或 lesson 范围。"),
 ("scope.needResource", "A resource session needs a resource_id.", "Una sesi\u00f3n de recurso necesita un resource_id.", "Eine Ressourcen-Sitzung braucht eine resource_id.", "Une session de ressource a besoin d\u2019un resource_id.", "Una sessione di risorsa ha bisogno di un resource_id.", "资源学习需要 resource_id。"),
 ("scope.noLesson", "A resource session cannot have a lesson: use the lesson scope.", "Una sesi\u00f3n de recurso no puede tener lecci\u00f3n: usa el \u00e1mbito lesson.", "Eine Ressourcen-Sitzung darf keine Lektion haben: nutze den Bereich lesson.", "Une session de ressource ne peut pas avoir de le\u00e7on : utilise la port\u00e9e lesson.", "Una sessione di risorsa non pu\u00f2 avere una lezione: usa l\u2019ambito lesson.", "资源学习不能有关联课时：请使用 lesson 范围。"),
 ("scope.needLesson", "A lesson session needs a lesson_id.", "Una sesi\u00f3n de lecci\u00f3n necesita un lesson_id.", "Eine Lektions-Sitzung braucht eine lesson_id.", "Une session de le\u00e7on a besoin d\u2019un lesson_id.", "Una sessione di lezione ha bisogno di un lesson_id.", "课时学习需要 lesson_id。"),
 ("scope.lesson", "Lesson", "Lecci\u00f3n", "Lektion", "Le\u00e7on", "Lezione", "课时"),
 ("scope.resource", "Resource", "Recurso", "Ressource", "Ressource", "Risorsa", "资源"),
 ("scope.global", "General review", "Repaso general", "Allgemeine Wiederholung", "Révision générale", "Ripasso generale", "综合复习"),
 ("settings.pkgInvalid", "The package is not valid.", "El paquete no es v\u00e1lido.", "Das Paket ist ung\u00fcltig.", "Le paquet n\u2019est pas valide.", "Il pacchetto non \u00e8 valido.", "该包无效。"),
 ("settings.jsonInvalid", "The file is not syntactically valid JSON.", "El archivo no contiene un JSON sint\u00e1cticamente v\u00e1lido.", "Die Datei enth\u00e4lt kein syntaktisch g\u00fcltiges JSON.", "Le fichier ne contient pas un JSON syntaxiquement valide.", "Il file non contiene un JSON sintatticamente valido.", "该文件不是语法有效的 JSON。"),
 ("dao.err.badRow", "Invalid SQL row: text expected at position {i}.", "Fila SQL inv\u00e1lida: se esperaba texto en la posici\u00f3n {i}.", "Ung\u00fcltige SQL-Zeile: Text an Position {i} erwartet.", "Ligne SQL invalide : texte attendu \u00e0 la position {i}.", "Riga SQL non valida: testo atteso alla posizione {i}.", "无效的 SQL 行：位置 {i} 应为文本。"),
 ("backup.err.unsafeRef", "The backup has incompatible internal references and cannot be restored safely.", "El respaldo contiene referencias internas incompatibles y no se puede restaurar de forma segura.", "Die Sicherung enth\u00e4lt inkompatible interne Referenzen und kann nicht sicher wiederhergestellt werden.", "La sauvegarde contient des r\u00e9f\u00e9rences internes incompatibles et ne peut pas \u00eatre restaur\u00e9e en s\u00e9curit\u00e9.", "Il backup contiene riferimenti interni incompatibili e non pu\u00f2 essere ripristinato in sicurezza.", "备份包含不兼容的内部引用，无法安全恢复。"),
]


def add_keys() -> None:
    idx = {"en": 0, "es": 1, "de": 2, "fr": 3, "it": 4, "zh": 5}
    for lang, i in idx.items():
        path = LOCALES / f"{lang}.ts"
        src = path.read_text(encoding="utf-8")
        missing = [(k, t[i]) for k, *t in KEYS if f"'{k}'" not in src]
        if not missing:
            print(f"{lang}: keys ok")
            continue
        lines = "".join(f"  '{k}': '{v}',\n" for k, v in missing)
        anchor = "} as const;" if lang == "en" else "};"
        src = src.replace(anchor, lines + anchor)
        path.write_text(src, encoding="utf-8")
        print(f"{lang}: added {len(missing)} keys")


def write_helper() -> None:
    p = BASE / "i18n/resolveAppLanguage.ts"
    if p.exists():
        print("skip helper (exists)")
        return
    p.write_text(
"""import { resolveStoredLanguage, type LanguageCode } from './languages.ts';

const STORAGE_KEY = 'crossedarts-language';

/**
 * Synchronous read of the effective UI language for non-React modules
 * (DAO, sqliteBridge). Same resolution as the `useLanguage` hook:
 * persisted choice, or the browser locale when set to automatic.
 */
export function resolveAppLanguage(): LanguageCode {
  try {
    const stored =
      typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const tag = nav ? (nav.languages?.[0] ?? nav.language ?? null) : null;
    return resolveStoredLanguage(stored, tag);
  } catch {
    return 'en';
  }
}
""",
        encoding="utf-8",
    )
    print("wrote resolveAppLanguage.ts")


def write_dao_lang() -> None:
    p = BASE / "db/daoLanguage.ts"
    if p.exists():
        print("skip daoLanguage (exists)")
        return
    p.write_text(
"""import type { LanguageCode } from '../i18n/languages.ts';
import { resolveAppLanguage } from '../i18n/resolveAppLanguage.ts';

let current: LanguageCode = resolveAppLanguage();

/** Module-level UI language for the data layer (mirrors Settings). */
export function setDaoLanguage(lang: LanguageCode): void {
  current = lang;
}

/** Current data-layer language. Defaults to the persisted/auto choice. */
export function daoLang(): LanguageCode {
  return current;
}
""",
        encoding="utf-8",
    )
    print("wrote daoLanguage.ts")


def dao_ts() -> None:
    F = "db/dao.ts"
    patch(F,
"import { asNullableString, asNullableNumber } from './dao/sqlRows.ts';",
"""import { asNullableString, asNullableNumber } from './dao/sqlRows.ts';
import { translateKey } from '../i18n/dictionaries.ts';
import { daoLang, setDaoLanguage } from './daoLanguage.ts';
import { goalKindLabel } from '../services/goals.ts';""")
    patch(F, "import { GOAL_KIND_LABELS } from '../services/goals.ts';\n",
       "")
    patch(F,
"    const consistency = validateStudySessionScope(scope, anchors);",
"    const consistency = validateStudySessionScope(scope, anchors, daoLang());")
    patch(F,
"      throw new Error(consistency.error || '\u00c1mbito de sesi\u00f3n incoherente.');",
"      throw new Error(consistency.error || translateKey(daoLang(), 'dao.err.sessionScope'));")
    patch(F,
"      return { success: false, error: 'El anverso y el reverso no pueden estar vac\u00edos.' };",
"      return { success: false, error: translateKey(daoLang(), 'dao.err.cardsBoth') };")
    patch(F,
"      if (!f) return { success: false, error: 'El anverso no puede estar vac\u00edo.' };",
"      if (!f) return { success: false, error: translateKey(daoLang(), 'dao.err.cardsFront') };")
    patch(F,
"      if (!b) return { success: false, error: 'El reverso no puede estar vac\u00edo.' };",
"      if (!b) return { success: false, error: translateKey(daoLang(), 'dao.err.cardsBack') };")
    patch(F,
"""      {
        nodeIds: graph.nodes.map(n => n.id),
        existingEdges: graph.edges.filter(e => !e.derived).map(e => ({ source_id: e.source_id, target_id: e.target_id, connection_type: e.connection_type }))
      }
    );""",
"""      {
        nodeIds: graph.nodes.map(n => n.id),
        existingEdges: graph.edges.filter(e => !e.derived).map(e => ({ source_id: e.source_id, target_id: e.target_id, connection_type: e.connection_type }))
      },
      daoLang()
    );""")
    patch(F,
"      return { success: false, error: validation.error || 'Conexi\u00f3n inv\u00e1lida.' };",
"      return { success: false, error: validation.error || translateKey(daoLang(), 'dao.err.connInvalid') };")
    patch(F,
"    if (title.length < 3) return { success: false, error: 'El t\u00edtulo del curso debe tener al menos 3 caracteres.' };",
"    if (title.length < 3) return { success: false, error: translateKey(daoLang(), 'dao.err.courseShort') };")
    patch(F,
"    if (title.length < 2) return { success: false, error: 'El t\u00edtulo del m\u00f3dulo es demasiado corto.' };",
"    if (title.length < 2) return { success: false, error: translateKey(daoLang(), 'dao.err.moduleShort') };")
    patch(F,
"    if (!input.moduleId) return { success: false, error: 'Debes seleccionar un m\u00f3dulo.' };",
"    if (!input.moduleId) return { success: false, error: translateKey(daoLang(), 'dao.err.needModule') };")
    patch(F,
"    if (title.length < 2) return { success: false, error: 'El t\u00edtulo de la lecci\u00f3n es demasiado corto.' };",
"    if (title.length < 2) return { success: false, error: translateKey(daoLang(), 'dao.err.lessonShort') };")
    patch(F,
"      return { success: false, error: 'El t\u00edtulo de la lecci\u00f3n es demasiado corto.' };",
"      return { success: false, error: translateKey(daoLang(), 'dao.err.lessonShort') };")
    patch(F,
"    if (!moduleRes.length || !moduleRes[0].values.length) return { success: false, error: 'El m\u00f3dulo indicado no existe.' };",
"    if (!moduleRes.length || !moduleRes[0].values.length) return { success: false, error: translateKey(daoLang(), 'dao.err.moduleGone') };")
    patch(F,
"      return { success: false, error: 'La duraci\u00f3n debe ser un n\u00famero no negativo.' };",
"      return { success: false, error: translateKey(daoLang(), 'dao.err.durationNeg') };")
    patch(F,
"    if (!lesson) return { success: false, error: 'La lecci\u00f3n indicada no existe.' };",
"    if (!lesson) return { success: false, error: translateKey(daoLang(), 'dao.err.lessonGone') };")
    patch(F,
"    if (index === -1) return { success: false, error: 'La lecci\u00f3n no pertenece al m\u00f3dulo.' };",
"    if (index === -1) return { success: false, error: translateKey(daoLang(), 'dao.err.lessonNotInModule') };")
    patch(F,
"      return { success: false, error: direction === 'up' ? 'La lecci\u00f3n ya es la primera.' : 'La lecci\u00f3n ya es la \u00faltima.' };",
"      return { success: false, error: direction === 'up' ? translateKey(daoLang(), 'dao.err.lessonFirst') : translateKey(daoLang(), 'dao.err.lessonLast') };")
    patch(F,
"      return { success: false, error: 'El n\u00famero de p\u00e1ginas debe ser mayor que cero.' };",
"      return { success: false, error: translateKey(daoLang(), 'dao.err.pagesPositive') };")
    patch(F,
"          subtitle: r[2] ? String(r[2]).slice(0, 80) : 'Trabajo pr\u00e1ctico',",
"          subtitle: r[2] ? String(r[2]).slice(0, 80) : translateKey(daoLang(), 'gallery.kind.practice'),")
    patch(F,
"        const kindLabel = GOAL_KIND_LABELS[String(r[3]) as keyof typeof GOAL_KIND_LABELS] || GOAL_KIND_LABELS.custom;",
"        const rawKind = String(r[3]);\n        const kindLabel = goalKindLabel(((['course', 'book', 'practice', 'study_time', 'custom'] as readonly string[]).includes(rawKind) ? rawKind : 'custom') as 'course' | 'book' | 'practice' | 'study_time' | 'custom', daoLang());")
    patch(F,
"          subtitle: `${kindLabel} \u00b7 ${String(r[4]) === 'completed' ? 'Completada' : 'Activa'}${r[2] ? ` \u00b7 ${String(r[2]).slice(0, 60)}` : ''}`",
"          subtitle: `${kindLabel} \u00b7 ${String(r[4]) === 'completed' ? translateKey(daoLang(), 'goals.deadline.completed') : translateKey(daoLang(), 'palette.goalActive')}${r[2] ? ` \u00b7 ${String(r[2]).slice(0, 60)}` : ''}`")
    # re-export so App can propagate the language in one import
    patch(F, "export const dao = {", "export { setDaoLanguage };\nexport const dao = {")


def dao_submodules() -> None:
    patch("db/dao/sessions.ts",
"import { generateDailyActivitySeries } from '../../services/domainLogic.ts';",
"""import { generateDailyActivitySeries } from '../../services/domainLogic.ts';
import type { LanguageCode } from '../../i18n/languages.ts';""")
    patch("db/dao/sessions.ts",
"  async getDailyActivitySeries(range: TimeRangeFilter = '7d'): Promise<DailyActivityPoint[]> {",
"  async getDailyActivitySeries(range: TimeRangeFilter = '7d', lang: LanguageCode = 'es'): Promise<DailyActivityPoint[]> {")
    patch("db/dao/sessions.ts",
"    return generateDailyActivitySeries(history, range, todayStr);",
"    return generateDailyActivitySeries(history, range, todayStr, lang);")
    patch("db/dao/practiceWork.ts",
"    const title = (work.title || '').trim() || 'Trabajo pr\u00e1ctico';",
"    const title = (work.title || '').trim() || translateKey(daoLang(), 'gallery.kind.practice');")
    patch("db/dao/sqlRows.ts",
"      throw new Error(`Fila SQL inv\u00e1lida: se esperaba texto en la posici\u00f3n ${index}`);",
"      throw new Error(translateKey(daoLang(), 'dao.err.badRow', { i: index }));")


def dao_sub_imports() -> None:
    for F in ["db/dao/practiceWork.ts", "db/dao/sqlRows.ts"]:
        p = BASE / F
        src = p.read_text(encoding="utf-8")
        if "daoLanguage" in src:
            print(f"skip imports {F}")
            continue
        lines = src.split("\n")
        idx = next(i for i, l in enumerate(lines) if l.startswith("import "))
        lines.insert(idx, "import { translateKey } from '../../i18n/dictionaries.ts';")
        lines.insert(idx + 1, "import { daoLang } from '../daoLanguage.ts';")
        p.write_text("\n".join(lines), encoding="utf-8")
        print(f"ok imports {F}")


def export_import() -> None:
    F = "db/exportImport.ts"
    ensure_top_import(F, "import { dbBridge } from './sqliteBridge.ts';",
      "import { translateKey } from '../i18n/dictionaries.ts';\nimport type { LanguageCode } from '../i18n/languages.ts';\n")
    patch(F,
"export function validateJsonBackup(data: unknown): BackupValidationResult {",
"export function validateJsonBackup(data: unknown, lang: LanguageCode = 'es'): BackupValidationResult {")
    patch(F,
"    return { valid: false, error: 'El archivo de respaldo no tiene un formato v\u00e1lido: se esperaba un objeto con las tablas de CrossedArts.' };",
"    return { valid: false, error: translateKey(lang, 'backup.err.badFormat') };")
    patch(F,
"    return { valid: false, error: 'Los metadatos del respaldo no tienen un formato v\u00e1lido.' };",
"    return { valid: false, error: translateKey(lang, 'backup.err.badMeta') };")
    patch(F,
"    return { valid: false, error: 'La versi\u00f3n del formato de respaldo no es v\u00e1lida.' };",
"    return { valid: false, error: translateKey(lang, 'backup.err.badVersion') };")
    patch(F,
"export async function importJsonBackup(data: Record<string, any[]>): Promise<void> {\n  const validation = validateJsonBackup(data);\n  if (!validation.valid) {\n    throw new Error(validation.error || 'El archivo de respaldo no es v\u00e1lido.');\n  }",
"export async function importJsonBackup(data: Record<string, any[]>, lang: LanguageCode = 'es'): Promise<void> {\n  const validation = validateJsonBackup(data, lang);\n  if (!validation.valid) {\n    throw new Error(validation.error || translateKey(lang, 'backup.err.invalidFile'));\n  }")
    patch(F,
"      throw new Error('El respaldo contiene referencias internas incompatibles y no se puede restaurar de forma segura.');",
"      throw new Error(translateKey(lang, 'backup.err.unsafeRef'));")
    patch(F,
"export async function importSqliteFile(file: File): Promise<void> {\n  if (file.size > 50 * 1024 * 1024) {\n    throw new Error('El archivo excede el tama\u00f1o m\u00e1ximo permitido para respaldos locales (50 MB).');\n  }",
"export async function importSqliteFile(file: File, lang: LanguageCode = 'es'): Promise<void> {\n  if (file.size > 50 * 1024 * 1024) {\n    throw new Error(translateKey(lang, 'backup.err.tooBig'));\n  }")


def sqlite_bridge() -> None:
    F = "db/sqliteBridge.ts"
    ensure_top_import(F, "import initSqlJs from 'sql.js';",
      "import { translateKey } from '../i18n/dictionaries.ts';\nimport type { LanguageCode } from '../i18n/languages.ts';\nimport { resolveAppLanguage } from '../i18n/resolveAppLanguage.ts';\n")
    patch(F,
"export class StaleWriteError extends Error {",
"""let dbLang: LanguageCode = resolveAppLanguage();

/** Module-level UI language for DB failure messages (mirrors Settings). */
export function setDbLanguage(lang: LanguageCode): void {
  dbLang = lang;
}

export class StaleWriteError extends Error {""")
    patch(F,
"    super('Otra pesta\u00f1a guard\u00f3 una versi\u00f3n m\u00e1s nueva de la base de datos. Recarga para continuar.');",
"    super(translateKey(dbLang, 'db.otherTab'));")
    patch(F,
"const INIT_FAILURE_MESSAGES: Record<DbInitFailureCode, { message: string; retryable: boolean }> = {",
"""function initFailureMessages(lang: LanguageCode = dbLang): Record<DbInitFailureCode, { message: string; retryable: boolean }> {
  const tr = (key: string): string => translateKey(lang, key);
  return {""")
    patch(F,
"""  unknown: {
    message: 'No se pudo inicializar la base de datos local. Vuelve a cargar la aplicaci\u00f3n; si el problema contin\u00faa, revisa el espacio disponible en tu navegador.',
    retryable: true
  }
};""",
"""  unknown: {
    message: tr('db.initFail'),
    retryable: true
  }
  };
}""")
    for es_msg, key in [
        ("'No se pudo cargar el motor SQLite en WebAssembly. Comprueba tu conexi\u00f3n y vuelve a cargar la aplicaci\u00f3n.'", "'db.wasmFail'"),
        ("'No se pudo acceder al almacenamiento local del navegador, as\u00ed que la base de datos no se ha podido abrir. Puede ocurrir en ventanas privadas o si el almacenamiento est\u00e1 bloqueado.'", "'db.storageBlocked'"),
        ("'La base de datos local guardada no se puede abrir de forma segura. Tus datos persistidos se han conservado intactos; restaura una copia compatible antes de continuar.'", "'db.unsafeOpen'"),
        ("'El esquema de la base de datos local no es v\u00e1lido, por lo que la aplicaci\u00f3n no puede funcionar.'", "'db.badSchema'"),
        ("'Otra pesta\u00f1a de CrossedArts ha actualizado tus datos. Recarga esta pesta\u00f1a antes de continuar.'", "'db.tabUpdated'"),
    ]:
        patch(F, f"    message: {es_msg},", f"    message: tr({key}),")
    patch(F, "  return { ...INIT_FAILURE_MESSAGES[code], code, detail };",
       "  return { ...initFailureMessages()[code], code, detail };")
    rep_all(F, "...INIT_FAILURE_MESSAGES['corrupt-storage'],",
       "...initFailureMessages()['corrupt-storage'],", expect=2)
    patch(F, "...INIT_FAILURE_MESSAGES['stale-other-tab'],",
       "...initFailureMessages()['stale-other-tab'],")
    rep_all(F, "...INIT_FAILURE_MESSAGES.unknown,",
       "...initFailureMessages().unknown,", expect=2)
    patch(F, "...INIT_FAILURE_MESSAGES['storage-unavailable'],",
       "...initFailureMessages()['storage-unavailable'],")
    patch(F, "{ ...INIT_FAILURE_MESSAGES.unknown, code: 'unknown' }",
       "{ ...initFailureMessages().unknown, code: 'unknown' }")
    patch(F,
"          this.setStorageState('corrupt-storage', 'Los datos guardados en IndexedDB no contienen una base de datos SQLite v\u00e1lida.');",
"          this.setStorageState('corrupt-storage', translateKey(dbLang, 'db.corruptStore'));")
    patch(F,
"            detail: 'Los bytes persistidos no tienen una cabecera SQLite v\u00e1lida.'",
"            detail: translateKey(dbLang, 'db.badHeader')")
    patch(F,
"        detail: 'La pesta\u00f1a actual est\u00e1 por detr\u00e1s de una revisi\u00f3n persistida m\u00e1s reciente.'",
"        detail: translateKey(dbLang, 'db.staleTab')")
    patch(F,
"        detail: 'getDatabase() llamado antes de que la inicializaci\u00f3n terminara.'",
"        detail: translateKey(dbLang, 'db.earlyAccess')")
    patch(F,
"          reject(new Error('La transacci\u00f3n de persistencia se abort\u00f3 tras comprometerse.'));",
"          reject(new Error(translateKey(dbLang, 'db.txnAbort')));")
    patch(F,
"      throw new Error('El archivo suministrado no contiene una cabecera SQLite v\u00e1lida (SQLite format 3).');",
"      throw new Error(translateKey(dbLang, 'db.badFileHeader'));")
    patch(F,
"          reject(new Error('Formato de instant\u00e1nea persistida no reconocido o no compatible en IndexedDB.'));",
"          reject(new Error(translateKey(dbLang, 'db.badSnapshot')));")
    patch(F,
"        if (msg.includes('Formato de instant\u00e1nea persistida no reconocido')) {",
"        if (msg.toLowerCase().includes('snapshot') || msg.includes('instant\u00e1nea') || msg.includes('\u5feb\u7167')) {")


def ensure_top_import(path_rel: str, anchor: str, stmt: str) -> None:
    p = BASE / path_rel
    src = p.read_text(encoding="utf-8")
    if stmt.split(' ')[1] in src:
        print(f"skip import {path_rel}")
        return
    assert anchor in src
    p.write_text(src.replace(anchor, stmt + "\n" + anchor, 1), encoding="utf-8")
    print(f"ok import {path_rel}")


def course_package() -> None:
    F = "services/coursePackage.ts"
    ensure_top_import(F, "export const COURSE_PACKAGE_FORMAT",
      "import { translateKey } from '../i18n/dictionaries.ts';\nimport type { LanguageCode } from '../i18n/languages.ts';\n")
    patch(F,
"export function validateCoursePackage(data: unknown): CoursePackageValidation {",
"export function validateCoursePackage(data: unknown, lang: LanguageCode = 'es'): CoursePackageValidation {")
    patch(F,
"    return { valid: false, error: 'El paquete no tiene un formato v\u00e1lido: se esperaba un objeto JSON.' };",
"    return { valid: false, error: translateKey(lang, 'pkg.badFormat') };")
    patch(F,
"    return { valid: false, error: 'El paquete no declara una versi\u00f3n v\u00e1lida.' };",
"    return { valid: false, error: translateKey(lang, 'pkg.badVersion') };")
    patch(F,
"    return { valid: false, error: 'El paquete no contiene un recurso v\u00e1lido (id y t\u00edtulo son obligatorios).' };",
"    return { valid: false, error: translateKey(lang, 'pkg.badResource') };")
    patch(F,
"export function describeImportResult(created: number, skipped: number): string {\n  if (created === 0 && skipped === 0) return 'El paquete estaba vac\u00edo.';",
"export function describeImportResult(created: number, skipped: number, lang: LanguageCode = 'es'): string {\n  if (created === 0 && skipped === 0) return translateKey(lang, 'pkg.empty');")
    patch(F,
"  if (created === 0) {\n    return `No hab\u00eda nada nuevo que importar (${skipped} elemento${skipped === 1 ? '' : 's'} ya exist\u00edan).`;\n  }",
"  if (created === 0) {\n    return skipped === 1\n      ? translateKey(lang, 'pkg.nothingNewOne')\n      : translateKey(lang, 'pkg.nothingNewOther', { n: skipped });\n  }")
    patch(F,
"  const base = `Paquete importado: ${created} elemento${created === 1 ? '' : 's'} nuevo${created === 1 ? '' : 's'}.`;",
"  const base = created === 1\n    ? translateKey(lang, 'pkg.importedOne')\n    : translateKey(lang, 'pkg.importedOther', { n: created });")
    patch(F,
"  return skipped > 0 ? `${base} ${skipped} ya exist\u00edan y se omitieron.` : base;",
"  return skipped > 0 ? `${base}${translateKey(lang, 'pkg.skipped', { n: skipped })}` : base;")
    patch(F,
"export function describeConflicts(conflicts: readonly CoursePackageConflict[]): string {\n  if (conflicts.length === 0) return '';\n  const label = conflicts.length === 1 ? '1 elemento ya exist\u00eda' : `${conflicts.length} elementos ya exist\u00edan`;\n  return `${label} con un contenido distinto: se conserv\u00f3 tu versi\u00f3n local y no se sobrescribi\u00f3 nada.`;",
"export function describeConflicts(conflicts: readonly CoursePackageConflict[], lang: LanguageCode = 'es'): string {\n  if (conflicts.length === 0) return '';\n  const label = conflicts.length === 1\n    ? translateKey(lang, 'pkg.conflictOneLabel')\n    : translateKey(lang, 'pkg.conflictOtherLabel', { n: conflicts.length });\n  return `${label}${translateKey(lang, 'pkg.conflictSuffix')}`;")


def session_scope() -> None:
    F = "services/sessionScope.ts"
    ensure_top_import(F, "export type StudySessionScope",
      "import { translateKey } from '../i18n/dictionaries.ts';\nimport type { LanguageCode } from '../i18n/languages.ts';\nimport { daoLang } from '../db/daoLanguage.ts';\n")
    patch(F,
"export function describeStudySessionScope(input: StudySessionScopeDescriptionInput): string {",
"export function describeStudySessionScope(input: StudySessionScopeDescriptionInput, lang: LanguageCode = 'es'): string {")
    rep_all(F, "studySessionScopeLabel(scope)", "studySessionScopeLabel(scope, lang)", expect=3)
    patch(F,
"export function validateStudySessionScope(\n  scope: StudySessionScope,\n  input: StudySessionScopeInput\n): StudySessionScopeConsistency {",
"export function validateStudySessionScope(\n  scope: StudySessionScope,\n  input: StudySessionScopeInput,\n  lang: LanguageCode = 'es'\n): StudySessionScopeConsistency {")
    patch(F,
"        error: 'Una sesi\u00f3n global no puede tener recurso ni lecci\u00f3n: elige el \u00e1mbito resource o lesson.'",
"        error: translateKey(lang, 'scope.globalLeak')")
    patch(F,
"      return { ok: false, error: 'Una sesi\u00f3n de recurso necesita un resource_id.' };",
"      return { ok: false, error: translateKey(lang, 'scope.needResource') };")
    patch(F,
"        error: 'Una sesi\u00f3n de recurso no puede tener lecci\u00f3n: usa el \u00e1mbito lesson.'",
"        error: translateKey(lang, 'scope.noLesson')")
    patch(F,
"    return { ok: false, error: 'Una sesi\u00f3n de lecci\u00f3n necesita un lesson_id.' };",
"    return { ok: false, error: translateKey(lang, 'scope.needLesson') };")
    patch(F,
"""export function studySessionScopeLabel(scope: StudySessionScope): string {
  switch (scope) {
    case 'lesson':
      return 'Lecci\u00f3n';
    case 'resource':
      return 'Recurso';""",
"""export function studySessionScopeLabel(scope: StudySessionScope, lang: LanguageCode = 'es'): string {
  switch (scope) {
    case 'lesson':
      return translateKey(lang, 'scope.lesson');
    case 'resource':
      return translateKey(lang, 'scope.resource');""")
    patch(F,
"""    case 'global':
    default:""",
"""    case 'global':
    default:
      return translateKey(lang, 'scope.global');""")


def app_and_settings() -> None:
    patch("pages/Dashboard.tsx",
"""                        {describeStudySessionScope({
                          scope: session.scope,
                          resourceTitle: session.resource_title,
                          lessonTitle: session.lesson_title
                        })}""",
"""                        {describeStudySessionScope({
                          scope: session.scope,
                          resourceTitle: session.resource_title,
                          lessonTitle: session.lesson_title
                        }, effective)}""")
    patch("App.tsx",
"import { dao } from './db/dao.ts';",
"import { dao, setDaoLanguage } from './db/dao.ts';")
    patch("App.tsx",
"import { dbBridge } from './db/sqliteBridge.ts';",
"import { dbBridge, setDbLanguage } from './db/sqliteBridge.ts';")
    patch("App.tsx",
"  const { t, effective } = useLanguage();\n\n  const handleMountLocalFolder = async () => {",
"  const { t, effective } = useLanguage();\n\n  useEffect(() => {\n    setDaoLanguage(effective);\n    setDbLanguage(effective);\n  }, [effective]);\n\n  const handleMountLocalFolder = async () => {")
    patch("pages/SettingsView.tsx",
"  const { t, language, setLanguage } = useLanguage();",
"  const { t, effective, language, setLanguage } = useLanguage();")
    rep_all("pages/SettingsView.tsx",
"        throw new Error('El archivo no contiene un JSON sint\u00e1cticamente v\u00e1lido.');",
"        throw new Error(t('settings.jsonInvalid'));", expect=2)
    patch("pages/SettingsView.tsx",
"      const validation = validateCoursePackage(parsed);",
"      const validation = validateCoursePackage(parsed, effective);")
    patch("pages/SettingsView.tsx",
"        setPackageFeedback({ type: 'error', text: validation.error || 'El paquete no es v\u00e1lido.' });",
"        setPackageFeedback({ type: 'error', text: validation.error || t('settings.pkgInvalid') });")
    patch("pages/SettingsView.tsx",
"      const conflictNote = describeConflicts(conflicts);",
"      const conflictNote = describeConflicts(conflicts, effective);")
    patch("pages/SettingsView.tsx",
"        text: conflictNote ? `${describeImportResult(created, skipped)} ${conflictNote}` : describeImportResult(created, skipped)",
"        text: conflictNote ? `${describeImportResult(created, skipped, effective)} ${conflictNote}` : describeImportResult(created, skipped, effective)")
    patch("pages/SettingsView.tsx",
"        await importJsonBackup(parsed as Record<string, any[]>);",
"        await importJsonBackup(parsed as Record<string, any[]>, effective);")
    patch("pages/SettingsView.tsx",
"        await importSqliteFile(file);",
"        await importSqliteFile(file, effective);")


if __name__ == "__main__":
    add_keys()
    write_helper()
    write_dao_lang()
    dao_ts()
    dao_submodules()
    dao_sub_imports()
    export_import()
    sqlite_bridge()
    course_package()
    session_scope()
    app_and_settings()
    print("OK s2e")
