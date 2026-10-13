"""Bulk i18n migration step 1: locale keys (6 languages) + service lang params.

Usage: python3 i18n_s1.py  (run from repo root)
Idempotent: skips keys already present; replacements check `old in src`.
"""
from pathlib import Path

BASE = Path("CrossedArts/frontend/src")
LOCALES = BASE / "i18n/locales"

# (key, en, es, de, fr, it, zh)
KEYS: list[tuple[str, str, str, str, str, str, str]] = [
 ("goals.kind.course", "Complete a course", "Completar un curso", "Einen Kurs abschließen", "Terminer un cours", "Completare un corso", "完成一门课程"),
 ("goals.kind.book", "Finish a book", "Terminar un libro", "Ein Buch beenden", "Terminer un livre", "Finire un libro", "读完一本书"),
 ("goals.kind.practice", "Complete practice work", "Completar trabajo práctico", "Praktische Arbeit abschließen", "Terminer un travail pratique", "Completare un lavoro pratico", "完成实践作业"),
 ("goals.kind.study_time", "Study time", "Tiempo de estudio", "Lernzeit", "Temps d\u2019\u00e9tude", "Tempo di studio", "学习时长"),
 ("goals.kind.custom", "Custom goal", "Meta personalizada", "Benutzerdefiniertes Ziel", "Objectif personnalis\u00e9", "Obiettivo personalizzato", "自定义目标"),
 ("goals.unit.lessons", "lessons", "lecciones", "Lektionen", "le\u00e7ons", "lezioni", "课时"),
 ("goals.unit.pages", "pages", "p\u00e1ginas", "Seiten", "pages", "pagine", "页"),
 ("goals.unit.pieces", "pieces", "piezas", "St\u00fccke", "pi\u00e8ces", "pezzi", "件"),
 ("goals.unit.minutes", "minutes", "minutos", "Minuten", "minutes", "minuti", "分钟"),
 ("goals.unit.none", "none", "ninguna", "keine", "aucune", "nessuna", "无"),
 ("goals.basis.noResource", "No linked resource.", "Sin recurso enlazado.", "Keine verkn\u00fcpfte Ressource.", "Aucune ressource li\u00e9e.", "Nessuna risorsa collegata.", "未关联资源。"),
 ("goals.basis.courseGone", "The linked course no longer exists.", "El curso enlazado ya no existe.", "Der verkn\u00fcpfte Kurs existiert nicht mehr.", "Le cours li\u00e9 n\u2019existe plus.", "Il corso collegato non esiste pi\u00f9.", "关联的课程已不存在。"),
 ("goals.basis.courseNoLessons", "The course has no recorded lessons.", "El curso no tiene lecciones registradas.", "Der Kurs hat keine erfassten Lektionen.", "Le cours n\u2019a aucune le\u00e7on enregistr\u00e9e.", "Il corso non ha lezioni registrate.", "该课程没有已记录的课时。"),
 ("goals.basis.courseLessons", "Completed lessons of \u00ab{title}\u00bb.", "Lecciones completadas del curso \u00ab{title}\u00bb.", "Abgeschlossene Lektionen des Kurses \u201e{title}\u201c.", "Le\u00e7ons termin\u00e9es du cours \u00ab {title} \u00bb.", "Lezioni completate del corso \u00ab{title}\u00bb.", "课程「{title}」已完成的课时。"),
 ("goals.basis.bookGone", "The linked book no longer exists.", "El libro enlazado ya no existe.", "Das verkn\u00fcpfte Buch existiert nicht mehr.", "Le livre li\u00e9 n\u2019existe plus.", "Il libro collegato non esiste pi\u00f9.", "关联的图书已不存在。"),
 ("goals.basis.bookNoPages", "The book has no page count.", "El libro no tiene n\u00famero de p\u00e1ginas.", "Das Buch hat keine Seitenzahl.", "Le livre n\u2019a pas de nombre de pages.", "Il libro non ha un numero di pagine.", "该图书没有页数记录。"),
 ("goals.basis.bookPages", "Pages read of \u00ab{title}\u00bb.", "P\u00e1ginas le\u00eddas del libro \u00ab{title}\u00bb.", "Gelesene Seiten des Buches \u201e{title}\u201c.", "Pages lues du livre \u00ab {title} \u00bb.", "Pagine lette del libro \u00ab{title}\u00bb.", "图书「{title}」已阅读的页数。"),
 ("goals.basis.practiceNoneScoped", "No practice work recorded with this resource.", "No hay trabajo pr\u00e1ctico registrado con este recurso.", "Keine praktische Arbeit mit dieser Ressource erfasst.", "Aucun travail pratique enregistr\u00e9 avec cette ressource.", "Nessun lavoro pratico registrato con questa risorsa.", "该资源下没有已记录的实践作业。"),
 ("goals.basis.practiceNone", "No practice work recorded yet.", "No hay trabajo pr\u00e1ctico registrado todav\u00eda.", "Noch keine praktische Arbeit erfasst.", "Aucun travail pratique enregistr\u00e9 pour le moment.", "Nessun lavoro pratico registrato finora.", "暂无已记录的实践作业。"),
 ("goals.basis.practiceTarget", "Finished practice work against your target.", "Trabajos pr\u00e1cticos terminados frente a tu objetivo.", "Abgeschlossene praktische Arbeiten im Vergleich zu deinem Ziel.", "Travaux pratiques termin\u00e9s par rapport \u00e0 ton objectif.", "Lavori pratici terminati rispetto al tuo obiettivo.", "相对目标已完成的实践作业。"),
 ("goals.basis.practiceAll", "Finished practice work out of recorded (your target is finishing all of them).", "Trabajos pr\u00e1cticos terminados sobre los registrados (tu objetivo es terminarlos todos).", "Abgeschlossene praktische Arbeiten von den erfassten (dein Ziel ist, alle zu beenden).", "Travaux pratiques termin\u00e9s parmi ceux enregistr\u00e9s (ton objectif est de tous les finir).", "Lavori pratici terminati tra quelli registrati (il tuo obiettivo \u00e8 finirli tutti).", "已记录中完成的实践作业（目标是全部完成）。"),
 ("goals.basis.studyNoTarget", "No minute target defined.", "Sin objetivo de minutos definido.", "Kein Minutenziel festgelegt.", "Aucun objectif de minutes d\u00e9fini.", "Nessun obiettivo di minuti definito.", "未设定分钟目标。"),
 ("goals.basis.studyMinutes", "Study minutes recorded since you created the goal.", "Minutos de estudio registrados desde que creaste la meta.", "Lernminuten seit Erstellung des Ziels.", "Minutes d\u2019\u00e9tude enregistr\u00e9es depuis la cr\u00e9ation de l\u2019objectif.", "Minuti di studio registrati dalla creazione dell\u2019obiettivo.", "自创建目标以来记录的学习分钟数。"),
 ("goals.basis.customManual", "Goal with no automatic measure: completed manually.", "Meta sin medida autom\u00e1tica: se completa manualmente.", "Ziel ohne automatische Messung: wird manuell abgeschlossen.", "Objectif sans mesure automatique : \u00e0 valider manuellement.", "Obiettivo senza misura automatica: da completare manualmente.", "无自动衡量的目标：手动完成。"),
 ("goals.validate.title", "The goal needs a title.", "La meta necesita un t\u00edtulo.", "Das Ziel braucht einen Titel.", "L\u2019objectif a besoin d\u2019un titre.", "L\u2019obiettivo ha bisogno di un titolo.", "目标需要一个标题。"),
 ("goals.validate.resource", "Select the resource this goal links to.", "Selecciona el recurso al que se vincula esta meta.", "W\u00e4hle die Ressource, mit der dieses Ziel verkn\u00fcpft ist.", "S\u00e9lectionne la ressource \u00e0 laquelle cet objectif est li\u00e9.", "Seleziona la risorsa a cui \u00e8 collegato questo obiettivo.", "选择此目标关联的资源。"),
 ("goals.validate.targetNumber", "The target value must be a number greater than zero.", "El valor objetivo debe ser un n\u00famero mayor que cero.", "Der Zielwert muss eine Zahl gr\u00f6\u00dfer als null sein.", "La valeur cible doit \u00eatre un nombre sup\u00e9rieur \u00e0 z\u00e9ro.", "Il valore obiettivo deve essere un numero maggiore di zero.", "目标值必须是大于零的数字。"),
 ("goals.validate.studyMinutes", "Set the target minutes for the study goal.", "Define los minutos objetivo de la meta de estudio.", "Lege die Zielminuten f\u00fcr das Lernziel fest.", "D\u00e9finis les minutes cibles de l\u2019objectif d\u2019\u00e9tude.", "Definisci i minuti obiettivo della meta di studio.", "请设定学习目标的目标分钟数。"),
 ("goals.validate.badDate", "The target date is not a valid date.", "La fecha objetivo no es una fecha v\u00e1lida.", "Das Zieldatum ist kein g\u00fcltiges Datum.", "La date cible n\u2019est pas une date valide.", "La data obiettivo non \u00e8 una data valida.", "目标日期不是有效日期。"),
 ("analytics.range.7d", "7 days", "7 d\u00edas", "7 Tage", "7 jours", "7 giorni", "7 天"),
 ("analytics.range.30d", "30 days", "30 d\u00edas", "30 Tage", "30 jours", "30 giorni", "30 天"),
 ("analytics.range.90d", "90 days", "90 d\u00edas", "90 Tage", "90 giorni", "90 giorni", "90 天"),
 ("analytics.range.all", "All", "Todo", "Alle", "Tout", "Tutto", "全部"),
 ("graph.node.concept", "Concept", "Concepto", "Konzept", "Concept", "Concetto", "概念"),
 ("graph.node.course", "Course", "Curso", "Kurs", "Cours", "Corso", "课程"),
 ("graph.node.book", "Book", "Libro", "Buch", "Livre", "Libro", "图书"),
 ("graph.node.module", "Module", "M\u00f3dulo", "Modul", "Module", "Modulo", "模块"),
 ("graph.node.lesson", "Lesson", "Lecci\u00f3n", "Lektion", "Le\u00e7on", "Lezione", "课时"),
 ("graph.node.note", "Note", "Nota", "Notiz", "Note", "Nota", "笔记"),
 ("graph.node.practice", "Practice work", "Trabajo pr\u00e1ctico", "Praktische Arbeit", "Travail pratique", "Lavoro pratico", "实践作业"),
 ("graph.node.resource", "Resource", "Recurso", "Ressource", "Ressource", "Risorsa", "资源"),
 ("graph.rel.contains", "contains", "contiene", "enth\u00e4lt", "contient", "contiene", "包含"),
 ("graph.rel.references", "references", "referencia", "verweist auf", "r\u00e9f\u00e9rence", "fa riferimento a", "引用"),
 ("graph.rel.teaches", "teaches", "ense\u00f1a", "lehrt", "enseigne", "insegna", "讲授"),
 ("graph.rel.discusses", "is about", "trata sobre", "behandelt", "traite de", "tratta di", "关于"),
 ("graph.rel.related_to", "related to", "relacionado con", "h\u00e4ngt zusammen mit", "li\u00e9 \u00e0", "correlato a", "与…相关"),
 ("graph.rel.requires", "requires", "requiere", "erfordert", "requiert", "richiede", "需要"),
 ("graph.rel.builds_on", "builds on", "se basa en", "baut auf", "se base sur", "si basa su", "基于"),
 ("graph.rel.about", "about", "trata de", "\u00fcber", "\u00e0 propos de", "riguarda", "关于"),
 ("practice.kind.exercise", "Exercise", "Ejercicio", "\u00dcbung", "Exercice", "Esercizio", "练习"),
 ("practice.kind.project", "Project", "Proyecto", "Projekt", "Projet", "Progetto", "项目"),
 ("practice.kind.essay", "Essay", "Ensayo", "Aufsatz", "Essai", "Saggio", "文章"),
 ("practice.kind.drawing", "Drawing", "Dibujo", "Zeichnung", "Dessin", "Disegno", "绘画"),
 ("practice.kind.code", "Code", "C\u00f3digo", "Code", "Code", "Codice", "代码"),
 ("practice.kind.other", "Other", "Otro", "Andere", "Autre", "Altro", "其他"),
 ("practice.status.PLANNED", "Planned", "Planificado", "Geplant", "Planifi\u00e9", "Pianificato", "已计划"),
 ("practice.status.IN_PROGRESS", "In progress", "En marcha", "In Arbeit", "En cours", "In corso", "进行中"),
 ("practice.status.DONE", "Done", "Terminado", "Fertig", "Termin\u00e9", "Completato", "已完成"),
 ("gallery.kind.course", "Course", "Curso", "Kurs", "Cours", "Corso", "课程"),
 ("gallery.kind.book", "Book", "Libro", "Buch", "Livre", "Libro", "图书"),
 ("gallery.kind.resource", "Resource", "Recurso", "Ressource", "Ressource", "Risorsa", "资源"),
 ("gallery.kind.practice", "Practice work", "Trabajo pr\u00e1ctico", "Praktische Arbeit", "Travail pratique", "Lavoro pratico", "实践作业"),
 ("gallery.meta.lessons", "{done}/{total} lessons", "{done}/{total} lecciones", "{done}/{total} Lektionen", "{done}/{total} le\u00e7ons", "{done}/{total} lezioni", "{done}/{total} 课时"),
 ("gallery.meta.pages", "P. {cur}/{total}", "P\u00e1g. {cur}/{total}", "S. {cur}/{total}", "P. {cur}/{total}", "Pag. {cur}/{total}", "第 {cur}/{total} 页"),
 ("gallery.meta.importedDoc", "Imported document", "Documento importado", "Importiertes Dokument", "Document import\u00e9", "Documento importato", "导入的文档"),
 ("palette.group.accion", "Actions", "Acciones", "Aktionen", "Actions", "Azioni", "操作"),
 ("palette.group.meta", "Goals", "Metas", "Ziele", "Objectifs", "Obiettivi", "目标"),
 ("palette.group.curso", "Courses", "Cursos", "Kurse", "Cours", "Corsi", "课程"),
 ("palette.group.libro", "Books", "Libros", "B\u00fccher", "Livres", "Libri", "图书"),
 ("palette.group.recurso", "Resources", "Recursos", "Ressourcen", "Ressources", "Risorse", "资源"),
 ("palette.group.practica", "Practice work", "Trabajo pr\u00e1ctico", "Praktische Arbeit", "Travail pratique", "Lavoro pratico", "实践作业"),
 ("palette.group.leccion", "Lessons", "Lecciones", "Lektionen", "Le\u00e7ons", "Lezioni", "课时"),
 ("palette.group.nota", "Notes", "Notas", "Notizen", "Notes", "Note", "笔记"),
 ("palette.group.concepto", "Concepts", "Conceptos", "Konzepte", "Concepts", "Concetti", "概念"),
 ("palette.nav.dashboard", "Go to Dashboard", "Ir al Dashboard", "Zum Dashboard", "Aller au tableau de bord", "Vai alla dashboard", "前往仪表盘"),
 ("palette.nav.dashboardSub", "Metrics, streak and shortcuts", "M\u00e9tricas, racha y accesos directos", "Kennzahlen, Serie und Kurzbefehle", "M\u00e9triques, s\u00e9rie et raccourcis", "Metriche, serie e scorciatoie", "指标、连击和快捷方式"),
 ("palette.nav.focus", "Go to Today", "Ir a Hoy", "Zu Heute", "Aller \u00e0 Aujourd\u2019hui", "Vai a Oggi", "前往今日"),
 ("palette.nav.focusSub", "What to do now, derived from your data", "Qu\u00e9 hacer ahora, derivado de tus datos", "Was jetzt zu tun ist, aus deinen Daten abgeleitet", "Quoi faire maintenant, \u00e0 partir de tes donn\u00e9es", "Cosa fare ora, dai tuoi dati", "根据你的数据决定现在做什么"),
 ("palette.nav.analytics", "Go to Analytics", "Ir a An\u00e1lisis", "Zu Analysen", "Aller aux analyses", "Vai alle analisi", "前往分析"),
 ("palette.nav.analyticsSub", "Time, consistency and real progress", "Tiempo, constancia y progreso real", "Zeit, Best\u00e4ndigkeit und echter Fortschritt", "Temps, r\u00e9gularit\u00e9 et progr\u00e8s r\u00e9els", "Tempo, costanza e progressi reali", "时间、坚持和真实进展"),
 ("palette.nav.goals", "Go to Goals", "Ir a Metas", "Zu Zielen", "Aller aux objectifs", "Vai agli obiettivi", "前往目标"),
 ("palette.nav.goalsSub", "Learning objectives with measured progress", "Objetivos de aprendizaje con progreso medido", "Lernziele mit gemessenem Fortschritt", "Objectifs d\u2019apprentissage au progr\u00e8s mesur\u00e9", "Obiettivi di apprendimento con progressi misurati", "带有可衡量进展的学习目标"),
 ("palette.nav.library", "Go to Library", "Ir a la Biblioteca", "Zur Bibliothek", "Aller \u00e0 la biblioth\u00e8que", "Vai alla biblioteca", "前往资料库"),
 ("palette.nav.librarySub", "Catalog of courses, books and resources", "Cat\u00e1logo de cursos, libros y recursos", "Katalog aus Kursen, B\u00fcchern und Ressourcen", "Catalogue de cours, livres et ressources", "Catalogo di corsi, libri e risorse", "课程、图书和资源目录"),
 ("palette.nav.graph", "Open the Knowledge graph", "Abrir el Grafo de conocimiento", "Wissensgraph \u00f6ffnen", "Ouvrir le graphe de connaissances", "Apri il grafo della conoscenza", "打开知识图谱"),
 ("palette.nav.graphSub", "Relations between courses, notes and concepts", "Relaciones entre cursos, notas y conceptos", "Beziehungen zwischen Kursen, Notizen und Konzepten", "Relations entre cours, notes et concepts", "Relazioni tra corsi, note e concetti", "课程、笔记和概念之间的关系"),
 ("palette.nav.notes", "Go to Notes", "Ir a Notas", "Zu Notizen", "Aller aux notes", "Vai alle note", "前往笔记"),
 ("palette.nav.notesSub", "All study notes", "Todas las notas de estudio", "Alle Lernnotizen", "Toutes les notes d\u2019\u00e9tude", "Tutte le note di studio", "所有学习笔记"),
 ("palette.nav.settings", "Go to Settings", "Ir a Ajustes", "Zu Einstellungen", "Aller aux r\u00e9glages", "Vai alle impostazioni", "前往设置"),
 ("palette.nav.settingsSub", "Backups, local AI and semantic index", "Copias de seguridad, IA local e \u00edndice sem\u00e1ntico", "Backups, lokale KI und semantischer Index", "Sauvegardes, IA locale et index s\u00e9mantique", "Backup, IA locale e indice semantico", "备份、本地 AI 和语义索引"),
 ("palette.continue", "Continue learning", "Continuar aprendiendo", "Weiterlernen", "Continuer \u00e0 apprendre", "Continua a imparare", "继续学习"),
 ("palette.review", "Review now", "Repasar ahora", "Jetzt wiederholen", "R\u00e9viser maintenant", "Ripassa ora", "现在复习"),
 ("palette.reviewDue.one", "{n} card due", "{n} tarjeta pendiente", "{n} f\u00e4llige Karte", "{n} carte \u00e0 r\u00e9viser", "{n} carta da ripassare", "{n} 张卡片待复习"),
 ("palette.reviewDue.other", "{n} cards due", "{n} tarjetas pendientes", "{n} f\u00e4llige Karten", "{n} cartes \u00e0 r\u00e9viser", "{n} carte da ripassare", "{n} 张卡片待复习"),
 ("palette.reviewEmpty", "SM-2 review session and practice questions", "Sesi\u00f3n de repaso SM-2 y preguntas de pr\u00e1ctica", "SM-2-Wiederholung und \u00dcbungsfragen", "Session de r\u00e9vision SM-2 et questions pratiques", "Sessione di ripasso SM-2 e domande pratiche", "SM-2 复习会话和练习题"),
 ("palette.tutor", "Open the AI Tutor", "Abrir el Tutor IA", "KI-Tutor \u00f6ffnen", "Ouvrir le tuteur IA", "Apri il tutor IA", "打开 AI 导师"),
 ("palette.tutorSub", "Ask about your local content", "Pregunta sobre tu contenido local", "Frag zu deinen lokalen Inhalten", "Pose des questions sur ton contenu local", "Chiedi sui tuoi contenuti locali", "询问你的本地内容"),
 ("palette.scan", "Scan local folder", "Escanear carpeta local", "Lokalen Ordner scannen", "Analyser un dossier local", "Scansiona la cartella locale", "扫描本地文件夹"),
 ("palette.scanSub", "Link videos from your disk to lessons", "Asociar v\u00eddeos de tu disco a las lecciones", "Videos von deiner Festplatte mit Lektionen verkn\u00fcpfen", "Associer des vid\u00e9os de ton disque aux le\u00e7ons", "Collega i video del tuo disco alle lezioni", "将磁盘中的视频关联到课时"),
 ("palette.backup", "Export backup", "Exportar copia de seguridad", "Backup exportieren", "Exporter une sauvegarde", "Esporta backup", "导出备份"),
 ("palette.backupSub", "Download the SQLite database", "Descarga la base de datos SQLite", "SQLite-Datenbank herunterladen", "T\u00e9l\u00e9charger la base SQLite", "Scarica il database SQLite", "下载 SQLite 数据库"),
 ("palette.themeLight", "Switch to light theme", "Cambiar a tema claro", "Zum hellen Theme wechseln", "Passer au th\u00e8me clair", "Passa al tema chiaro", "切换到浅色主题"),
 ("palette.themeDark", "Switch to dark theme", "Cambiar a tema oscuro", "Zum dunklen Theme wechseln", "Passer au th\u00e8me sombre", "Passa al tema scuro", "切换到深色主题"),
 ("palette.themeSub", "Toggle the interface theme", "Alternar el tema de la interfaz", "Theme der Oberfl\u00e4che wechseln", "Changer le th\u00e8me de l\u2019interface", "Cambia il tema dell\u2019interfaccia", "切换界面主题"),
 ("palette.courseFallback", "Course", "Curso", "Kurs", "Cours", "Corso", "课程"),
 ("palette.bookFallback", "Book", "Libro", "Buch", "Livre", "Libro", "图书"),
 ("palette.noteLesson", "Lesson note", "Nota de lecci\u00f3n", "Lektionsnotiz", "Note de le\u00e7on", "Nota di lezione", "课时笔记"),
 ("palette.noteResource", "Resource note", "Nota de recurso", "Ressourcennotiz", "Note de ressource", "Nota di risorsa", "资源笔记"),
 ("palette.noteGeneral", "General note", "Nota general", "Allgemeine Notiz", "Note g\u00e9n\u00e9rale", "Nota generale", "常规笔记"),
 ("palette.goalActive", "Active", "Activa", "Aktiv", "Actif", "Attivo", "进行中"),
 ("palette.goalTarget", "target {date}", "objetivo {date}", "Ziel {date}", "objectif {date}", "obiettivo {date}", "目标 {date}"),
]

LANG_FILES = {"en": 1, "es": 2, "de": 3, "fr": 4, "it": 5, "zh": 6}


def add_keys() -> None:
    keys = [k for k, *_ in KEYS]
    assert len(keys) == len(set(keys)), "duplicate keys"
    for lang, idx in LANG_FILES.items():
        path = LOCALES / f"{lang}.ts"
        src = path.read_text(encoding="utf-8")
        missing = [(k, t[idx - 1]) for k, *t in KEYS if f"'{k}'" not in src]
        if not missing:
            print(f"{lang}: all {len(KEYS)} keys present")
            continue
        lines = "".join(f"  '{k}': '{v}',\n" for k, v in missing)
        anchor = "} as const;" if lang == "en" else "};"
        assert anchor in src, f"anchor missing in {lang}"
        src = src.replace(anchor, lines + anchor)
        path.write_text(src, encoding="utf-8")
        print(f"{lang}: added {len(missing)} keys")


def patch(path_rel: str, old: str, new: str) -> None:
    p = BASE / path_rel
    src = p.read_text(encoding="utf-8")
    if old not in src:
        assert new in src, f"NEITHER old NOR new in {path_rel}: {old[:70]!r}"
        print(f"skip (done) {path_rel}: {old[:50]!r}...")
        return
    assert src.count(old) == 1, f"MULTIPLE ({src.count(old)}) in {path_rel}: {old[:70]!r}"
    p.write_text(src.replace(old, new), encoding="utf-8")
    print(f"patched {path_rel}: {old[:50]!r}...")


def ensure_import(path_rel: str, stmt: str, anchor: str) -> None:
    p = BASE / path_rel
    src = p.read_text(encoding="utf-8")
    if stmt in src:
        return
    assert anchor in src, f"import anchor missing in {path_rel}"
    p.write_text(src.replace(anchor, stmt + "\n" + anchor, 1), encoding="utf-8")
    print(f"import added to {path_rel}")


I18N_IMPORT = "import { translateKey } from '../i18n/dictionaries.ts';"
LANG_IMPORT = "import type { LanguageCode } from '../i18n/languages.ts';"


def patch_services() -> None:
    # ---- goals.ts ----
    patch("services/goals.ts",
"""/** Orden estable para poblar selectores. */
export const GOAL_KINDS: GoalKind[] = ['course', 'book', 'practice', 'study_time', 'custom'];""",
"""/** Orden estable para poblar selectores. */
export const GOAL_KINDS: GoalKind[] = ['course', 'book', 'practice', 'study_time', 'custom'];

/**
 * Localized goal-kind label. Defaults to Spanish to preserve the historic
 * behavior (existing callers and tests omit the language).
 */
export function goalKindLabel(kind: GoalKind, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `goals.kind.${kind}`);
}

/** Localized unit label for a goal measure. */
export function goalUnitLabel(unit: GoalUnit, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `goals.unit.${unit}`);
}""")
    patch("services/goals.ts",
"export function validateGoalDraft(draft: GoalDraft): GoalValidation {\n  if (!draft.title || !draft.title.trim()) {\n    return { ok: false, error: 'La meta necesita un t\u00edtulo.' };\n  }",
"export function validateGoalDraft(draft: GoalDraft, lang: LanguageCode = 'es'): GoalValidation {\n  if (!draft.title || !draft.title.trim()) {\n    return { ok: false, error: translateKey(lang, 'goals.validate.title') };\n  }")
    patch("services/goals.ts",
"    return { ok: false, error: 'Selecciona el recurso al que se vincula esta meta.' };",
"    return { ok: false, error: translateKey(lang, 'goals.validate.resource') };")
    patch("services/goals.ts",
"      return { ok: false, error: 'El valor objetivo debe ser un n\u00famero mayor que cero.' };",
"      return { ok: false, error: translateKey(lang, 'goals.validate.targetNumber') };")
    patch("services/goals.ts",
"    return { ok: false, error: 'Define los minutos objetivo de la meta de estudio.' };",
"    return { ok: false, error: translateKey(lang, 'goals.validate.studyMinutes') };")
    patch("services/goals.ts",
"      return { ok: false, error: 'La fecha objetivo no es una fecha v\u00e1lida.' };",
"      return { ok: false, error: translateKey(lang, 'goals.validate.badDate') };")
    patch("services/goals.ts",
"export function computeGoalProgress(goal: LearningGoal, context: GoalProgressContext): GoalProgress {\n  const unit = GOAL_UNIT_BY_KIND[goal.kind] ?? 'ninguna';",
"export function computeGoalProgress(\n  goal: LearningGoal,\n  context: GoalProgressContext,\n  lang: LanguageCode = 'es'\n): GoalProgress {\n  const unit = GOAL_UNIT_BY_KIND[goal.kind] ?? 'ninguna';\n  const tr = (key: string, params?: Record<string, string | number | null | undefined>): string =>\n    translateKey(lang, key, params);")
    for es_basis, key, params in [
        ("'Sin recurso enlazado.'", "goals.basis.noResource", None),
        ("'El curso enlazado ya no existe.'", "goals.basis.courseGone", None),
        ("'El curso no tiene lecciones registradas.'", "goals.basis.courseNoLessons", None),
        ("`Lecciones completadas del curso \u00ab${course.title}\u00bb.`", "goals.basis.courseLessons", "{ title: course.title }"),
        ("'El libro enlazado ya no existe.'", "goals.basis.bookGone", None),
        ("'El libro no tiene n\u00famero de p\u00e1ginas.'", "goals.basis.bookNoPages", None),
        ("`P\u00e1ginas le\u00eddas del libro \u00ab${book.title}\u00bb.`", "goals.basis.bookPages", "{ title: book.title }"),
        ("'No hay trabajo pr\u00e1ctico registrado con este recurso.'", "goals.basis.practiceNoneScoped", None),
        ("'No hay trabajo pr\u00e1ctico registrado todav\u00eda.'", "goals.basis.practiceNone", None),
        ("'Trabajos pr\u00e1cticos terminados frente a tu objetivo.'", "goals.basis.practiceTarget", None),
        ("'Trabajos pr\u00e1cticos terminados sobre los registrados (tu objetivo es terminarlos todos).'", "goals.basis.practiceAll", None),
        ("'Sin objetivo de minutos definido.'", "goals.basis.studyNoTarget", None),
        ("'Minutos de estudio registrados desde que creaste la meta.'", "goals.basis.studyMinutes", None),
        ("'Meta sin medida autom\u00e1tica: se completa manualmente.'", "goals.basis.customManual", None),
    ]:
        new = f"tr('{key}')" if params is None else f"tr('{key}', {params})"
        p = BASE / "services/goals.ts"
        src = p.read_text(encoding="utf-8")
        if es_basis not in src:
            assert new in src, f"NEITHER in goals.ts: {es_basis!r}"
            print(f"skip (done) goals basis: {key}")
            continue
        p.write_text(src.replace(es_basis, new), encoding="utf-8")
        print(f"patched goals basis ({src.count(es_basis)}x): {key}")

    # ---- useGoalProgress ----
    patch("hooks/useGoalProgress.ts",
"""export function useGoalProgress(
  goals: readonly LearningGoal[],
  courses: readonly Course[],
  books: readonly Book[],
  practiceWork: readonly PracticeWork[]
): Map<string, GoalProgress> {""",
"""export function useGoalProgress(
  goals: readonly LearningGoal[],
  courses: readonly Course[],
  books: readonly Book[],
  practiceWork: readonly PracticeWork[],
  lang: LanguageCode = 'es'
): Map<string, GoalProgress> {""")
    patch("hooks/useGoalProgress.ts",
"import type { Book, Course, LearningGoal, PracticeWork } from '../types/models.ts';",
"import type { Book, Course, LearningGoal, PracticeWork } from '../types/models.ts';\nimport type { LanguageCode } from '../i18n/languages.ts';")
    patch("hooks/useGoalProgress.ts",
"      map.set(goal.id, computeGoalProgress(goal, context));",
"      map.set(goal.id, computeGoalProgress(goal, context, lang));")

    # ---- practiceWork.ts ----
    ensure_import("services/practiceWork.ts", I18N_IMPORT, "export const PRACTICE_WORK_KIND_LABELS")
    ensure_import("services/practiceWork.ts", LANG_IMPORT, "export const PRACTICE_WORK_KIND_LABELS")
    patch("services/practiceWork.ts",
"""/** Etiqueta legible del tipo, con degradaci\u00f3n segura ante valores desconocidos. */
export function practiceWorkKindLabel(kind?: string): string {
  if (kind && kind in PRACTICE_WORK_KIND_LABELS) {
    return PRACTICE_WORK_KIND_LABELS[kind as PracticeWorkKind];
  }
  return PRACTICE_WORK_KIND_LABELS.other;
}""",
"""/** Etiqueta legible del tipo, con degradaci\u00f3n segura ante valores desconocidos. */
export function practiceWorkKindLabel(kind?: string, lang: LanguageCode = 'es'): string {
  if (kind && kind in PRACTICE_WORK_KIND_LABELS) {
    return translateKey(lang, `practice.kind.${kind}`);
  }
  return translateKey(lang, 'practice.kind.other');
}""")
    patch("services/practiceWork.ts",
"""/** Etiqueta legible del estado, con degradaci\u00f3n segura ante valores desconocidos. */
export function practiceWorkStatusLabel(status?: string): string {
  if (status && status in PRACTICE_WORK_STATUS_LABELS) {
    return PRACTICE_WORK_STATUS_LABELS[status as PracticeWorkStatus].text;
  }""",
"""/** Etiqueta legible del estado, con degradaci\u00f3n segura ante valores desconocidos. */
export function practiceWorkStatusLabel(status?: string, lang: LanguageCode = 'es'): string {
  if (status && status in PRACTICE_WORK_STATUS_LABELS) {
    return translateKey(lang, `practice.status.${status}`);
  }""")

    # ---- analytics.ts ----
    ensure_import("services/analytics.ts", I18N_IMPORT, "export const ANALYTICS_RANGE_LABELS")
    ensure_import("services/analytics.ts", LANG_IMPORT, "export const ANALYTICS_RANGE_LABELS")
    patch("services/analytics.ts",
"""export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  '7d': '7 d\u00edas',
  '30d': '30 d\u00edas',
  '90d': '90 d\u00edas',
  all: 'Todo'
};""",
"""export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  '7d': '7 d\u00edas',
  '30d': '30 d\u00edas',
  '90d': '90 d\u00edas',
  all: 'Todo'
};

/** Localized range label. Defaults to Spanish (existing callers omit it). */
export function analyticsRangeLabel(range: AnalyticsRange, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `analytics.range.${range}`);
}""")

    # ---- domainLogic.ts ----
    ensure_import("services/domainLogic.ts", I18N_IMPORT, "export const GRAPH_NODE_LABELS")
    ensure_import("services/domainLogic.ts", LANG_IMPORT, "export const GRAPH_NODE_LABELS")
    patch("services/domainLogic.ts",
"""export const GRAPH_RELATION_LABELS: Record<GraphRelationType, string> = {""",
"""/** Localized node-type label. Defaults to Spanish (existing callers omit it). */
export function graphNodeLabel(type: GraphNodeType, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `graph.node.${type}`);
}

/** Localized relation label. Defaults to Spanish (existing callers omit it). */
export function graphRelationLabel(relation: GraphRelationType, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `graph.rel.${relation}`);
}

export const GRAPH_RELATION_LABELS: Record<GraphRelationType, string> = {""")

    # ---- galleryItems.ts ----
    ensure_import("services/galleryItems.ts", I18N_IMPORT, "export type ArtifactKind")
    ensure_import("services/galleryItems.ts", LANG_IMPORT, "export type ArtifactKind")
    patch("services/galleryItems.ts",
"""/** Prefijo con el que se construye el id de cada artefacto normalizado. */""",
"""/** Localized artifact-kind label. Defaults to Spanish (callers omit it). */
export function artifactKindLabel(kind: ArtifactKind, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `gallery.kind.${kind}`);
}

/** Prefijo con el que se construye el id de cada artefacto normalizado. */""")
    patch("services/galleryItems.ts",
"""export function buildGalleryItems(
  courses: Course[],
  books: Book[],
  sources: GallerySources = {}
): GalleryItem[] {""",
"""export function buildGalleryItems(
  courses: Course[],
  books: Book[],
  sources: GallerySources = {},
  lang: LanguageCode = 'es'
): GalleryItem[] {
  const tr = (key: string, params?: Record<string, string | number | null | undefined>): string =>
    translateKey(lang, key, params);""")
    patch("services/galleryItems.ts", "kindLabel: ARTIFACT_KIND_LABELS.course,", "kindLabel: tr('gallery.kind.course'),")
    patch("services/galleryItems.ts", "kindLabel: ARTIFACT_KIND_LABELS.book,", "kindLabel: tr('gallery.kind.book'),")
    patch("services/galleryItems.ts", "kindLabel: ARTIFACT_KIND_LABELS.resource,", "kindLabel: tr('gallery.kind.resource'),")
    patch("services/galleryItems.ts", "kindLabel: ARTIFACT_KIND_LABELS.practice,", "kindLabel: tr('gallery.kind.practice'),")
    patch("services/galleryItems.ts",
"    meta: `${course.completed_lessons || 0}/${course.total_lessons || 0} lecciones`",
"    meta: tr('gallery.meta.lessons', { done: course.completed_lessons || 0, total: course.total_lessons || 0 })")
    patch("services/galleryItems.ts",
"        ? `P\u00e1g. ${book.current_page || 0}/${book.page_count}`",
"        ? tr('gallery.meta.pages', { cur: book.current_page || 0, total: book.page_count })")
    patch("services/galleryItems.ts",
"      meta: resource.category || 'Documento importado'",
"      meta: resource.category || tr('gallery.meta.importedDoc')")
    patch("services/galleryItems.ts",
"    meta: practiceWorkKindLabel(work.kind)",
"    meta: practiceWorkKindLabel(work.kind, lang)")

    # ---- commandPalette.ts ----
    ensure_import("services/commandPalette.ts", I18N_IMPORT, "export const PALETTE_GROUP_LABELS")
    ensure_import("services/commandPalette.ts", LANG_IMPORT, "export const PALETTE_GROUP_LABELS")
    patch("services/commandPalette.ts",
"import { GOAL_KIND_LABELS } from './goals.ts';",
"import { GOAL_KIND_LABELS, goalKindLabel } from './goals.ts';")
    patch("services/commandPalette.ts",
"""/** Orden fijo de los grupos en la paleta: vista predecible de un vistazo. */""",
"""const NAV_ACTION_STRINGS: Record<string, { titleKey: string; subtitleKey: string }> = {
  'accion:dashboard': { titleKey: 'palette.nav.dashboard', subtitleKey: 'palette.nav.dashboardSub' },
  'accion:focus': { titleKey: 'palette.nav.focus', subtitleKey: 'palette.nav.focusSub' },
  'accion:analytics': { titleKey: 'palette.nav.analytics', subtitleKey: 'palette.nav.analyticsSub' },
  'accion:goals': { titleKey: 'palette.nav.goals', subtitleKey: 'palette.nav.goalsSub' },
  'accion:library': { titleKey: 'palette.nav.library', subtitleKey: 'palette.nav.librarySub' },
  'accion:graph': { titleKey: 'palette.nav.graph', subtitleKey: 'palette.nav.graphSub' },
  'accion:notes': { titleKey: 'palette.nav.notes', subtitleKey: 'palette.nav.notesSub' },
  'accion:settings': { titleKey: 'palette.nav.settings', subtitleKey: 'palette.nav.settingsSub' }
};

/** Navigation actions with localized title/subtitle (Spanish when omitted). */
export function navigationActions(lang: LanguageCode = 'es'): PaletteItem[] {
  return NAVIGATION_ACTIONS.map(action => {
    const keys = NAV_ACTION_STRINGS[action.id];
    if (!keys) return { ...action };
    return {
      ...action,
      title: translateKey(lang, keys.titleKey),
      subtitle: translateKey(lang, keys.subtitleKey)
    };
  });
}

/** Localized palette group label. Defaults to Spanish (callers omit it). */
export function paletteGroupLabel(group: PaletteGroup, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `palette.group.${group}`);
}

/** Orden fijo de los grupos en la paleta: vista predecible de un vistazo. */""")
    patch("services/commandPalette.ts",
"export function buildPaletteCatalog(input: PaletteCatalogInput): PaletteItem[] {\n  const items: PaletteItem[] = NAVIGATION_ACTIONS.map(action => ({ ...action }));",
"export function buildPaletteCatalog(input: PaletteCatalogInput, lang: LanguageCode = 'es'): PaletteItem[] {\n  const items: PaletteItem[] = navigationActions(lang);\n  const tr = (key: string, params?: Record<string, string | number | null | undefined>): string =>\n    translateKey(lang, key, params);")
    patch("services/commandPalette.ts",
"      title: 'Continuar aprendiendo',",
"      title: tr('palette.continue'),")
    patch("services/commandPalette.ts",
"    title: 'Repasar ahora',\n    subtitle:\n      input.pendingReviews > 0\n        ? `${input.pendingReviews} ${input.pendingReviews === 1 ? 'tarjeta pendiente' : 'tarjetas pendientes'}`\n        : 'Sesi\u00f3n de repaso SM-2 y preguntas de pr\u00e1ctica',",
"    title: tr('palette.review'),\n    subtitle:\n      input.pendingReviews > 0\n        ? tr(`palette.reviewDue.${input.pendingReviews === 1 ? 'one' : 'other'}`, { n: input.pendingReviews })\n        : tr('palette.reviewEmpty'),")
    patch("services/commandPalette.ts",
"    title: 'Abrir el Tutor IA',\n    subtitle: 'Pregunta sobre tu contenido local',",
"    title: tr('palette.tutor'),\n    subtitle: tr('palette.tutorSub'),")
    patch("services/commandPalette.ts",
"    title: 'Escanear carpeta local',\n    subtitle: 'Asociar v\u00eddeos de tu disco a las lecciones',",
"    title: tr('palette.scan'),\n    subtitle: tr('palette.scanSub'),")
    patch("services/commandPalette.ts",
"    title: 'Exportar copia de seguridad',\n    subtitle: 'Descarga la base de datos SQLite',",
"    title: tr('palette.backup'),\n    subtitle: tr('palette.backupSub'),")
    patch("services/commandPalette.ts",
"    title: input.isDarkTheme ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',\n    subtitle: 'Alternar el tema de la interfaz',",
"    title: input.isDarkTheme ? tr('palette.themeLight') : tr('palette.themeDark'),\n    subtitle: tr('palette.themeSub'),")
    patch("services/commandPalette.ts",
"      subtitle: course.description || course.category || 'Curso',",
"      subtitle: course.description || course.category || tr('palette.courseFallback'),")
    patch("services/commandPalette.ts",
"      subtitle: book.author || book.description || 'Libro',",
"      subtitle: book.author || book.description || tr('palette.bookFallback'),")
    patch("services/commandPalette.ts",
"    const context = note.lesson_id ? 'Nota de lecci\u00f3n' : note.resource_id ? 'Nota de recurso' : 'Nota general';",
"    const context = note.lesson_id\n      ? tr('palette.noteLesson')\n      : note.resource_id\n        ? tr('palette.noteResource')\n        : tr('palette.noteGeneral');")
    patch("services/commandPalette.ts",
"      subtitle: resource.resourceCategory || 'Recurso importado',",
"      subtitle: resource.resourceCategory || tr('gallery.meta.importedDoc'),")
    patch("services/commandPalette.ts",
"      subtitle: concept.conceptDescription || 'Concepto',",
"      subtitle: concept.conceptDescription || tr('graph.node.concept'),")
    patch("services/commandPalette.ts",
"    const kindLabel = practiceWorkKindLabel(work.practiceKind);",
"    const kindLabel = practiceWorkKindLabel(work.practiceKind, lang);")
    patch("services/commandPalette.ts",
"        : `${kindLabel} \u00b7 ${practiceWorkStatusLabel(work.practiceStatus)}`,",
"        : `${kindLabel} \u00b7 ${practiceWorkStatusLabel(work.practiceStatus, lang)}`,")
    patch("services/commandPalette.ts",
"    const kindLabel = GOAL_KIND_LABELS[goal.kind] ?? GOAL_KIND_LABELS.custom;",
"    const kindLabel = goalKindLabel(goal.kind, lang);")
    patch("services/commandPalette.ts",
"""      subtitle: goal.status === 'completed'
        ? `${kindLabel} \u00b7 Completada`
        : `${kindLabel} \u00b7 Activa${goal.target_date ? ` \u00b7 objetivo ${goal.target_date.slice(0, 10)}` : ''}`,""",
"""      subtitle: goal.status === 'completed'
        ? `${kindLabel} \u00b7 ${tr('goals.deadline.completed')}`
        : `${kindLabel} \u00b7 ${tr('palette.goalActive')}${goal.target_date ? ` \u00b7 ${tr('palette.goalTarget', { date: goal.target_date.slice(0, 10) })}` : ''}`,""")
    patch("services/commandPalette.ts",
"""export function groupPaletteItems<T extends PaletteItem | PaletteMatch>(
  items: T[]
): Array<{ group: PaletteGroup; label: string; items: T[] }> {""",
"""export function groupPaletteItems<T extends PaletteItem | PaletteMatch>(
  items: T[],
  lang: LanguageCode = 'es'
): Array<{ group: PaletteGroup; label: string; items: T[] }> {""")
    patch("services/commandPalette.ts",
"    if (groupItems.length) result.push({ group, label: PALETTE_GROUP_LABELS[group], items: groupItems });",
"    if (groupItems.length) result.push({ group, label: paletteGroupLabel(group, lang), items: groupItems });")

    # ---- focus.ts: hook useGoalProgress callers pass lang later; nothing here ----


if __name__ == "__main__":
    add_keys()
    patch_services()
    print("OK step 1")
