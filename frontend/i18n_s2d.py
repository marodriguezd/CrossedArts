"""Bulk i18n step 2d: migrate the 5 mid-size pages. Run from repo root."""
import sys
sys.path.insert(0, 'CrossedArts/frontend')
from i18n_s2c import patch, rep_all

EXTRA_KEYS: list[tuple[str, str, str, str, str, str, str]] = [
 ("graph.nodeGeneric", "node", "nodo", "Knoten", "n\u0153ud", "nodo", "节点"),
 ("graph.saveFail", "Error saving the connection.", "Error al guardar la conexi\u00f3n.", "Fehler beim Speichern der Verbindung.", "Erreur lors de l\u2019enregistrement de la connexion.", "Errore durante il salvataggio della connessione.", "保存连接时出错。"),
]


def add_extra_keys() -> None:
    from i18n_s2c import BASE, LOCALES
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


def goals_view() -> None:
    F = "pages/GoalsView.tsx"
    patch(F,
"""import {
  GOAL_DEADLINE_LABELS,
  GOAL_KINDS,
  GOAL_KIND_LABELS,
  classifyGoalDeadline,
  normalizeGoalDate,
  summarizeGoals,
  validateGoalDraft,
  type GoalDeadlineState,
  type GoalProgress
} from '../services/goals.ts';""",
"""import {
  GOAL_KINDS,
  classifyGoalDeadline,
  goalDeadlineLabel,
  goalKindLabel,
  goalUnitLabel,
  normalizeGoalDate,
  summarizeGoals,
  validateGoalDraft,
  type GoalDeadlineState,
  type GoalProgress,
  type GoalUnit
} from '../services/goals.ts';
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';
import { useLanguage } from '../hooks/useLanguage.ts';""")
    patch(F,
"""const KIND_OPTIONS: Array<{ value: GoalKind; label: string }> = GOAL_KINDS.map(kind => ({
  value: kind,
  label: GOAL_KIND_LABELS[kind]
}));""",
"""/* Goal-kind options are built in-component (localized). */""")
    patch(F,
"""/** Etiqueta honesta de la medida de una meta (nunca concatena unidades). */
function progressLine(progress: GoalProgress): string {
  if (!progress.measurable) return progress.basis;
  const current = progress.current ?? 0;
  const target = progress.target;
  if (target === null) return progress.basis;
  return `${current} / ${target} ${progress.unit}`;
}""",
"""/** Etiqueta honesta de la medida de una meta (nunca concatena unidades). */
function progressLine(progress: GoalProgress, lang: LanguageCode = 'es'): string {
  if (!progress.measurable) return progress.basis;
  const current = progress.current ?? 0;
  const target = progress.target;
  if (target === null) return progress.basis;
  return translateKey(lang, 'goals.page.measureOf', {
    cur: current,
    target,
    unit: goalUnitLabel(progress.unit as GoalUnit, lang)
  });
}""")
    patch(F,
"""  const { day: localDay } = resolveLocalDay();
  const progressByGoal = useGoalProgress(goals, courses, books, practiceWork);""",
"""  const { day: localDay } = resolveLocalDay();
  const { t, effective } = useLanguage();
  const progressByGoal = useGoalProgress(goals, courses, books, practiceWork, effective);
  const kindOptions = GOAL_KINDS.map(kind => ({ value: kind, label: goalKindLabel(kind, effective) }));""")
    patch(F,
"""    const options = [
      ...courses.map(course => ({ id: course.id, title: `Curso \u00b7 ${course.title}` })),
      ...books.map(book => ({ id: book.id, title: `Libro \u00b7 ${book.title}` }))
    ];
    return options.sort((a, b) => a.title.localeCompare(b.title));
  }, [courses, books]);""",
"""    const options = [
      ...courses.map(course => ({ id: course.id, title: t('goals.page.coursePrefix', { title: course.title }) })),
      ...books.map(book => ({ id: book.id, title: t('goals.page.bookPrefix', { title: book.title }) }))
    ];
    return options.sort((a, b) => a.title.localeCompare(b.title));
  }, [courses, books, t]);""")
    patch(F,
"""    const validation = validateGoalDraft({
      title: draft.title,
      description: draft.description,
      kind: draft.kind,
      resource_id: needsResource ? draft.resource_id : draft.resource_id || null,
      target_value: targetValue,
      target_date: draft.target_date || null
    });
    if (!validation.ok) {
      setFormError(validation.error || 'No se pudo crear la meta.');
      return;
    }""",
"""    const validation = validateGoalDraft({
      title: draft.title,
      description: draft.description,
      kind: draft.kind,
      resource_id: needsResource ? draft.resource_id : draft.resource_id || null,
      target_value: targetValue,
      target_date: draft.target_date || null
    }, effective);
    if (!validation.ok) {
      setFormError(validation.error || t('goals.page.createFail'));
      return;
    }""")
    patch(F,
"""    } catch {
      setFormError('No se pudo guardar la meta en tu base local.');
    }""",
"""    } catch {
      setFormError(t('goals.page.saveLocalFail'));
    }""")
    patch(F,
"""    } catch {
      setActionError('No se pudo marcar la meta como completada.');
    }""",
"""    } catch {
      setActionError(t('goals.page.completeFail'));
    }""")
    patch(F,
"""    } catch {
      setActionError('No se pudo reabrir la meta.');
    }""",
"""    } catch {
      setActionError(t('goals.page.reopenFail'));
    }""")
    patch(F,
"""    if (!editDraft.title.trim()) {
      setActionError('La meta necesita un t\u00edtulo.');
      return;
    }""",
"""    if (!editDraft.title.trim()) {
      setActionError(t('goals.validate.title'));
      return;
    }""")
    patch(F,
"""    const validation = validateGoalDraft({
      title: editDraft.title,
      kind: goal.kind,
      resource_id: goal.resource_id,
      target_value: targetValue,
      target_date: editDraft.target_date || null
    });
    if (!validation.ok) {
      setActionError(validation.error || 'Revisa los datos de la meta.');
      return;
    }""",
"""    const validation = validateGoalDraft({
      title: editDraft.title,
      kind: goal.kind,
      resource_id: goal.resource_id,
      target_value: targetValue,
      target_date: editDraft.target_date || null
    }, effective);
    if (!validation.ok) {
      setActionError(validation.error || t('goals.page.checkFallback'));
      return;
    }""")
    patch(F,
"""    } catch {
      setActionError('No se pudieron guardar los cambios de la meta.');
    }""",
"""    } catch {
      setActionError(t('goals.page.saveFail'));
    }""")
    patch(F,
"""    } catch {
      setActionError('No se pudo eliminar la meta.');
      setPendingDelete(null);
    }""",
"""    } catch {
      setActionError(t('goals.page.deleteFail'));
      setPendingDelete(null);
    }""")
    # --- JSX ---
    patch(F, '<h1 className="type-display text-ink">Metas</h1>',
       '<h1 className="type-display text-ink">{t(\'goals.page.title\')}</h1>')
    patch(F, 'Planifica tu aprendizaje. El progreso se mide siempre sobre tus datos reales.',
       '{t(\'goals.page.subtitle\')}')
    patch(F, '<Plus size={15} aria-hidden="true" />\n          Nueva meta',
       '<Plus size={15} aria-hidden="true" />\n          {t(\'goals.page.newGoal\')}')
    patch(F, '<div className="flex flex-wrap gap-2" aria-label="Resumen de metas">',
       '<div className="flex flex-wrap gap-2" aria-label={t(\'goals.page.summaryLabel\')}>')
    patch(F, "<Badge tone=\"accent\">{summary.active} activa{summary.active === 1 ? '' : 's'}</Badge>",
       "<Badge tone=\"accent\">{t('goals.page.active', { n: summary.active, s: summary.active === 1 ? '' : 's' })}</Badge>")
    patch(F, "<Badge tone={summary.overdue > 0 ? 'warning' : 'neutral'}>{summary.overdue} vencida{summary.overdue === 1 ? '' : 's'}</Badge>",
       "<Badge tone={summary.overdue > 0 ? 'warning' : 'neutral'}>{t('goals.page.overdue', { n: summary.overdue, s: summary.overdue === 1 ? '' : 's' })}</Badge>")
    patch(F, '<Badge tone="neutral">{summary.dueSoon} por vencer</Badge>',
       '<Badge tone="neutral">{t(\'goals.page.dueSoon\', { n: summary.dueSoon })}</Badge>')
    patch(F, "{summary.readyToComplete} lista{summary.readyToComplete === 1 ? '' : 's'} para cerrar",
       "{t('goals.page.ready', { n: summary.readyToComplete, s: summary.readyToComplete === 1 ? '' : 's' })}")
    patch(F, "<Badge tone=\"neutral\">{summary.completed} completada{summary.completed === 1 ? '' : 's'}</Badge>",
       "<Badge tone=\"neutral\">{t('goals.page.done', { n: summary.completed, s: summary.completed === 1 ? '' : 's' })}</Badge>")
    patch(F, '<h2 className="type-section text-ink">Nueva meta</h2>',
       '<h2 className="type-section text-ink">{t(\'goals.page.newGoal\')}</h2>')
    rep_all(F, '<span className="type-micro text-muted">T\u00edtulo</span>',
       '<span className="type-micro text-muted">{t(\'goals.page.titleLabel\')}</span>', expect=2)
    patch(F, 'placeholder="p. ej. Terminar el curso de React 18"',
       'placeholder={t(\'goals.page.titlePh\')}')
    patch(F, '<span className="type-micro text-muted">Tipo de meta</span>',
       '<span className="type-micro text-muted">{t(\'goals.page.kindLabel\')}</span>')
    patch(F, '{KIND_OPTIONS.map(option => (', '{kindOptions.map(option => (')
    patch(F, "{needsResource ? 'Recurso' : '\u00c1mbito (opcional)'}",
       "{needsResource ? t('goals.page.resourceLabel') : t('goals.page.scopeLabel')}")
    patch(F, '<option value="">{needsResource ? \'Selecciona\u2026\' : \'Toda la biblioteca\'}</option>',
       '<option value="">{needsResource ? t(\'goals.page.selectPh\') : t(\'goals.page.allLibrary\')}</option>')
    patch(F, "{draft.kind === 'study_time' ? 'Minutos objetivo' : 'N\u00ba de piezas objetivo'}",
       "{draft.kind === 'study_time' ? t('goals.page.targetMinutes') : t('goals.page.targetPieces')}")
    patch(F, "placeholder={draft.kind === 'study_time' ? 'p. ej. 600' : 'p. ej. 5'}",
       "placeholder={draft.kind === 'study_time' ? t('goals.page.targetPhMinutes') : t('goals.page.targetPhPieces')}")
    patch(F, '<span className="type-micro text-muted">Fecha objetivo (opcional)</span>',
       '<span className="type-micro text-muted">{t(\'goals.page.dueLabel\')}</span>')
    patch(F, '<span className="type-micro text-muted">Descripci\u00f3n (opcional)</span>',
       '<span className="type-micro text-muted">{t(\'goals.page.descLabel\')}</span>')
    rep_all(F, '>Cancelar</Button>', '>{t(\'goals.page.cancel\')}</Button>', expect=2)
    patch(F, '<Button variant="solid" onClick={() => void handleCreate()}>Crear meta</Button>',
       '<Button variant="solid" onClick={() => void handleCreate()}>{t(\'goals.page.create\')}</Button>')
    patch(F, 'title="A\u00fan no hay metas"',
       'title={t(\'goals.page.emptyTitle\')}')
    patch(F, 'hint="Define qu\u00e9 quieres conseguir (terminar un curso, leer un libro, registrar pr\u00e1ctica) y CrossedArts medir\u00e1 el avance sobre tus datos reales."',
       'hint={t(\'goals.page.emptyHint\')}')
    patch(F, '<Plus size={14} aria-hidden="true" /> Crear la primera meta',
       '<Plus size={14} aria-hidden="true" /> {t(\'goals.page.firstGoal\')}')
    patch(F, '<ul className="space-y-3" aria-label="Metas de aprendizaje">',
       '<ul className="space-y-3" aria-label={t(\'goals.page.listLabel\')}>')
    patch(F, "{goal.status === 'completed' ? 'Completada' : 'Activa'}",
       "{goal.status === 'completed' ? t('goals.deadline.completed') : t('palette.goalActive')}")
    patch(F, """{deadline === 'no_deadline'
                          ? 'Sin fecha'
                          : deadline === 'completed'
                            ? GOAL_DEADLINE_LABELS.completed
                            : `Fecha: ${due ?? '-'} \u00b7 ${GOAL_DEADLINE_LABELS[deadline]}`}""",
"""                      {deadline === 'no_deadline'
                          ? t('goals.page.noDate')
                          : deadline === 'completed'
                            ? goalDeadlineLabel('completed', effective)
                            : t('goals.page.dateLine', { date: due ?? '-', state: goalDeadlineLabel(deadline, effective) })}""")
    patch(F, '<Badge tone="neutral">{GOAL_KIND_LABELS[goal.kind]}</Badge>',
       '<Badge tone="neutral">{goalKindLabel(goal.kind, effective)}</Badge>')
    patch(F, 'aria-label={`Progreso de \u00ab${goal.title}\u00bb: ${progressLine(progress)}`}',
       'aria-label={t(\'goals.page.progressSr\', { title: goal.title, line: progressLine(progress, effective) })}')
    patch(F, '<span className="text-muted">{progressLine(progress)}</span>',
       '<span className="text-muted">{progressLine(progress, effective)}</span>')
    patch(F, """{progress.missingResource
                              ? `${progress.basis} Puedes eliminar o reasignir la meta.`
                              : progress.basis}""",
"""{progress.missingResource
                              ? t('goals.page.missingHint', { basis: progress.basis })
                              : progress.basis}""")
    patch(F, 'title="Marcar la meta como completada"',
       'title={t(\'goals.page.completeTitle\')}')
    patch(F, '<Check size={13} aria-hidden="true" /> Completada',
       '<Check size={13} aria-hidden="true" /> {t(\'goals.page.completeBtn\')}')
    patch(F, 'title="Reabrir la meta"',
       'title={t(\'goals.page.reopenTitle\')}')
    patch(F, '<RotateCcw size={13} aria-hidden="true" /> Reabrir',
       '<RotateCcw size={13} aria-hidden="true" /> {t(\'goals.page.reopenBtn\')}')
    patch(F, 'aria-label={isEditing ? `Cancelar edici\u00f3n de ${goal.title}` : `Editar ${goal.title}`}',
       'aria-label={isEditing ? t(\'goals.page.cancelEditSr\', { title: goal.title }) : t(\'goals.page.editSr\', { title: goal.title })}')
    patch(F, "<Pencil size={13} aria-hidden=\"true\" /> {isEditing ? 'Cancelar' : 'Editar'}",
       "<Pencil size={13} aria-hidden=\"true\" /> {isEditing ? t('goals.page.cancel') : t('goals.page.editBtn')}")
    patch(F, 'aria-label={`Eliminar meta ${goal.title}`}\n                      title="Eliminar meta"',
       'aria-label={t(\'goals.page.deleteSr\', { title: goal.title })}\n                      title={t(\'goals.page.deleteTitle\')}')
    patch(F, '<span className="type-micro text-muted">Fecha objetivo</span>',
       '<span className="type-micro text-muted">{t(\'goals.page.editDue\')}</span>')
    patch(F, "{goal.kind === 'study_time' ? 'Minutos objetivo' : 'N\u00ba de piezas'}",
       "{goal.kind === 'study_time' ? t('goals.page.targetMinutes') : t('goals.page.editPieces')}")
    patch(F, '<span className="type-micro text-muted">Descripci\u00f3n</span>',
       '<span className="type-micro text-muted">{t(\'goals.page.editDesc\')}</span>')
    patch(F, '<Button size="sm" variant="solid" onClick={() => void handleSaveEdit(goal)}>Guardar</Button>',
       '<Button size="sm" variant="solid" onClick={() => void handleSaveEdit(goal)}>{t(\'goals.page.save\')}</Button>')
    patch(F, 'Creada: {goal.created_at ? goal.created_at.slice(0, 10) : \'-\'}',
       '{t(\'goals.page.created\', { date: goal.created_at ? goal.created_at.slice(0, 10) : \'-\' })}')
    patch(F, 'Actualizada: {goal.updated_at ? goal.updated_at.slice(0, 10) : \'-\'}',
       '{t(\'goals.page.updated\', { date: goal.updated_at ? goal.updated_at.slice(0, 10) : \'-\' })}')
    patch(F, '<span>Completada: {goal.completed_at.slice(0, 10)}</span>',
       '<span>{t(\'goals.page.doneOn\', { date: goal.completed_at.slice(0, 10) })}</span>')
    patch(F, 'title="Eliminar meta"\n        consequence={',
       'title={t(\'goals.page.deleteTitle\')}\n        consequence={')
    patch(F, '? `Se eliminar\u00e1 \u00ab${pendingDelete.title}\u00bb. Tu progreso real de estudio no se ve afectado: las metas no almacenan datos de estudio.`',
       '? t(\'goals.page.deleteConfirm\', { title: pendingDelete.title })')
    patch(F, 'confirmLabel="Eliminar"',
       'confirmLabel={t(\'goals.page.confirmDelete\')}')
    rep_all(F, 'progressByGoal.get(goal.id) ?? fallbackProgress()',
       'progressByGoal.get(goal.id) ?? fallbackProgress(effective)', expect=2)
    patch(F,
"""function fallbackProgress(): GoalProgress {""",
"""function fallbackProgress(lang: LanguageCode = 'es'): GoalProgress {""")
    patch(F, "basis: 'Calculando progreso\u2026',",
       "basis: translateKey(lang, 'goals.page.calcProgress'),")


def notes_view() -> None:
    F = "pages/NotesView.tsx"
    patch(F,
"import { Button, SearchInput, Badge, EmptyState, Chip, cn } from '../components/ui/index.tsx';",
"import { Button, SearchInput, Badge, EmptyState, Chip, cn } from '../components/ui/index.tsx';\nimport { useLanguage } from '../hooks/useLanguage.ts';")
    patch(F,
"""export const NotesView: React.FC<NotesViewProps> = ({ notes, onRefresh, initialNoteId }) => {
  const [selectedNote, setSelectedNote] = useState<Note | null>(notes[0] || null);""",
"""export const NotesView: React.FC<NotesViewProps> = ({ notes, onRefresh, initialNoteId }) => {
  const { t, effective } = useLanguage();
  const [selectedNote, setSelectedNote] = useState<Note | null>(notes[0] || null);""")
    # rename shadowing map params t -> tag
    rep_all(F, '.map(t => t.trim())', '.map(tag => tag.trim())', expect=2)
    rep_all(F, ".filter(t => t && !t.startsWith('sha256:'))", ".filter(tag => tag && !tag.startsWith('sha256:'))", expect=2)
    rep_all(F, 'prev === t.toLowerCase() ? null : t.toLowerCase()', 'prev === tag.toLowerCase() ? null : tag.toLowerCase()', expect=2)
    rep_all(F, 'key={t}', 'key={tag}', expect=2)
    rep_all(F, '#{t}', '#{tag}', expect=2)
    # service calls with lang
    patch(F,
"""      speechService.speak(
        text,
        () => setIsPlayingNoteAudio(false),
        () => setIsPlayingNoteAudio(false)
      );""",
"""      speechService.speak(
        text,
        () => setIsPlayingNoteAudio(false),
        () => setIsPlayingNoteAudio(false),
        effective
      );""")
    patch(F,
"""        (errorMsg: string) => {
          setIsDictating(false);
          setDictationError(errorMsg);
        }
      );""",
"""        (errorMsg: string) => {
          setIsDictating(false);
          setDictationError(errorMsg);
        },
        effective
      );""")
    patch(F, 'exportNotesToSingleMarkdown(filteredNotes.length > 0 ? filteredNotes : notes)',
       'exportNotesToSingleMarkdown(filteredNotes.length > 0 ? filteredNotes : notes, effective)')
    patch(F,
"""                      const md = exportNoteToMarkdown(selectedNote, {
                        resourceTitle: resourceName(selectedNote.resource_id),
                        lessonTitle: lessonName(selectedNote.lesson_id)
                      });""",
"""                      const md = exportNoteToMarkdown(selectedNote, {
                        resourceTitle: resourceName(selectedNote.resource_id),
                        lessonTitle: lessonName(selectedNote.lesson_id)
                      }, effective);""")
    # JSX
    patch(F, '<h1 className="type-display text-ink">Notas</h1>',
       '<h1 className="type-display text-ink">{t(\'notes.title\')}</h1>')
    patch(F, 'Tus notas, ideas y referencias en Markdown con persistencia local.',
       '{t(\'notes.subtitle\')}')
    patch(F, 'title="Exportar todas las notas visibles en un \u00fanico archivo Markdown (.md)"',
       'title={t(\'notes.exportAllTitle\')}')
    patch(F, 'Exportar notas ({filteredNotes.length > 0 ? filteredNotes.length : notes.length})',
       '{t(\'notes.exportNotes\', { n: filteredNotes.length > 0 ? filteredNotes.length : notes.length })}')
    patch(F, '<Plus size={15} aria-hidden="true" /> Nueva nota',
       '<Plus size={15} aria-hidden="true" /> {t(\'notes.newNote\')}')
    patch(F, 'label="Buscar notas"\n            placeholder="Buscar notas\u2026"',
       'label={t(\'notes.searchLabel\')}\n            placeholder={t(\'notes.searchPh\')}')
    patch(F, '<div className="mb-3 flex flex-wrap gap-1.5" role="toolbar" aria-label="Filtrar por etiqueta">',
       '<div className="mb-3 flex flex-wrap gap-1.5" role="toolbar" aria-label={t(\'notes.filterByTag\')}>')
    patch(F, 'Todas ({notes.length})', '{t(\'notes.all\', { n: notes.length })}')
    patch(F, "'A\u00fan no hay notas.'", "t('notes.emptyNone')")
    patch(F, '? `No hay notas con la etiqueta \u00ab#${selectedTag}\u00bb${query ? \' y esa b\u00fasqueda\' : \'\'}.`',
       '? t(\'notes.emptyTag\', { tag: selectedTag, extra: query ? t(\'notes.emptyTagExtra\') : \'\' })')
    patch(F, ": 'Sin coincidencias para esa b\u00fasqueda.'}", ": t('notes.emptySearch')}")
    patch(F, 'Limpiar filtros', '{t(\'notes.clearFilters\')}')
    rep_all(F, '.map(t => (', '.map(tag => (', expect=1)
    rep_all(F, '.map(t => {', '.map(tag => {', expect=1)
    patch(F, 'title={t(\'notes.filterBy\', { tag })}', 'title={t(\'notes.filterBy\', { tag })}')
    patch(F, "{isCreating ? 'Crear nueva nota' : `Editar: ${selectedNote?.title}`}",
       "{isCreating ? t('notes.createTitle') : t('notes.editTitle', { title: selectedNote?.title ?? '' })}")
    patch(F, '<PenTool size={12} aria-hidden="true" /> Escribir',
       '<PenTool size={12} aria-hidden="true" /> {t(\'notes.write\')}')
    patch(F, '<Eye size={12} aria-hidden="true" /> Vista previa',
       '<Eye size={12} aria-hidden="true" /> {t(\'notes.preview\')}')
    patch(F, '<label className={LABEL_CLS} htmlFor="note-title">T\u00edtulo</label>',
       '<label className={LABEL_CLS} htmlFor="note-title">{t(\'notes.titleLabel\')}</label>')
    patch(F, 'placeholder="T\u00edtulo de la nota"', 'placeholder={t(\'notes.titlePh\')}')
    patch(F, '<label className={LABEL_CLS} htmlFor="note-tags">Etiquetas (separadas por coma)</label>',
       '<label className={LABEL_CLS} htmlFor="note-tags">{t(\'notes.tagsLabel\')}</label>')
    patch(F, 'placeholder="react, hooks, arquitectura"', 'placeholder="react, hooks, architecture"')
    patch(F, '<label className={LABEL_CLS} htmlFor="note-resource">Recurso asociado (opcional)</label>',
       '<label className={LABEL_CLS} htmlFor="note-resource">{t(\'notes.resourceLabel\')}</label>')
    patch(F, '<option value="">Sin recurso espec\u00edfico</option>',
       '<option value="">{t(\'notes.noResource\')}</option>')
    patch(F, '<label className={LABEL_CLS} htmlFor="note-lesson">Lecci\u00f3n asociada (opcional)</label>',
       '<label className={LABEL_CLS} htmlFor="note-lesson">{t(\'notes.lessonLabel\')}</label>')
    patch(F, '<option value="">Sin lecci\u00f3n</option>',
       '<option value="">{t(\'notes.noLesson\')}</option>')
    patch(F, '<label className={LABEL_CLS} htmlFor="note-content">Contenido (Markdown soportado)</label>',
       '<label className={LABEL_CLS} htmlFor="note-content">{t(\'notes.contentLabel\')}</label>')
    patch(F, 'title={isDictating ? "Detener dictado por voz" : "Dictar por voz"}',
       'title={isDictating ? t(\'notes.dictStop\') : t(\'notes.dictStart\')}')
    patch(F, '<span>{isDictating ? "Escuchando\u2026" : "Dictar"}</span>',
       '<span>{isDictating ? t(\'notes.listening\') : t(\'notes.dictate\')}</span>')
    patch(F, 'placeholder="Escribe tus notas en Markdown (# t\u00edtulos, **negrita**, *cursiva*, ```bloques de c\u00f3digo```, - listas, [02:30] marcas de tiempo)\u2026"',
       'placeholder={t(\'notes.contentPh\')}')
    patch(F, 'Escribe algo en la pesta\u00f1a \u00abEscribir\u00bb para previsualizarlo en Markdown.',
       '{t(\'notes.previewHint\')}')
    patch(F, '<X size={14} aria-hidden="true" /> Cancelar',
       '<X size={14} aria-hidden="true" /> {t(\'notes.cancel\')}')
    patch(F, "{isCreating ? 'Guardar nota en SQLite' : 'Guardar cambios'}",
       "{isCreating ? t('notes.saveNote') : t('notes.saveChanges')}")
    patch(F, 'Fecha: {selectedNote.created_at?.slice(0, 10)}',
       '{t(\'notes.date\', { date: selectedNote.created_at?.slice(0, 10) ?? \'\' })}')
    patch(F, 'title={t(\'notes.filterListBy\', { tag })}', 'title={t(\'notes.filterListBy\', { tag })}')
    patch(F, '<Link2 size={11} aria-hidden="true" /> Asociada a:',
       '<Link2 size={11} aria-hidden="true" /> {t(\'notes.linkedAs\')}')
    patch(F, 'title={isPlayingNoteAudio ? "Detener lectura en voz alta" : "Leer nota en voz alta"}',
       'title={isPlayingNoteAudio ? t(\'notes.stopReading\') : t(\'notes.readAloud\')}')
    patch(F, "{isPlayingNoteAudio ? 'Detener' : 'Escuchar'}",
       "{isPlayingNoteAudio ? t('notes.stop') : t('notes.listen')}")
    patch(F, 'title="Exportar esta nota en archivo Markdown (.md)"',
       'title={t(\'notes.exportOneTitle\')}')
    patch(F, '<Download size={13} aria-hidden="true" /> Exportar .md',
       '<Download size={13} aria-hidden="true" /> {t(\'notes.exportMd\')}')
    patch(F, '<Edit3 size={13} aria-hidden="true" /> Editar',
       '<Edit3 size={13} aria-hidden="true" /> {t(\'notes.edit\')}')
    patch(F, '<Trash2 size={13} aria-hidden="true" /> Eliminar',
       '<Trash2 size={13} aria-hidden="true" /> {t(\'notes.delete\')}')
    patch(F, 'title="Selecciona una nota"',
       'title={t(\'notes.selectNote\')}')
    patch(F, 'hint="Elige una nota de la lista para leerla o pulsa \u00abNueva nota\u00bb para crearla."',
       'hint={t(\'notes.selectHint\')}')
    patch(F, 'title="Eliminar nota"\n        consequence={',
       'title={t(\'notes.deleteTitle\')}\n        consequence={')
    patch(F, 'consequence={`Se eliminar\u00e1 permanentemente la nota "${selectedNote?.title}". Esta acci\u00f3n no se puede deshacer.`}',
       'consequence={t(\'notes.deleteCons\', { title: selectedNote?.title ?? \'\' })}')
    patch(F, 'confirmLabel="Eliminar nota"\n        cancelLabel="Cancelar"',
       'confirmLabel={t(\'notes.deleteTitle\')}\n        cancelLabel={t(\'notes.cancel\')}')


def resource_detail() -> None:
    F = "pages/ResourceDetail.tsx"
    patch(F,
"import { GRAPH_NODE_LABELS, GRAPH_RELATION_LABELS } from '../services/domainLogic.ts';",
"import { GRAPH_RELATION_LABELS, graphNodeLabel, graphRelationLabel } from '../services/domainLogic.ts';\nimport type { GraphRelationType } from '../types/models.ts';\nimport { useLanguage } from '../hooks/useLanguage.ts';")
    patch(F,
"""}) => {
  const [detail, setDetail] = useState<ResourceDetailModel | null>(null);""",
"""}) => {
  const { t, effective } = useLanguage();
  const [detail, setDetail] = useState<ResourceDetailModel | null>(null);""")
    patch(F, "setPackageFeedback('No se pudo preparar el paquete: el recurso ya no existe.');",
       "setPackageFeedback(t('res.exportFailGone'));")
    patch(F, "'Material exportado como paquete educativo (temario y trabajo propuesto). No incluye tu progreso, notas ni sesiones. Comp\u00e1rtelo para que otra persona lo importe.'",
       "t('res.exportOk')")
    patch(F, "setPackageFeedback('No se pudo exportar el paquete del recurso.');",
       "setPackageFeedback(t('res.exportFail'));")
    patch(F, "setError('Este recurso ya no existe en la base local.');",
       "setError(t('res.goneError'));")
    patch(F, "setError(err?.message || 'No se pudo cargar el detalle del recurso.');",
       "setError(err?.message || t('res.loadFail'));")
    patch(F, "setMetaFeedback({ text: 'El n\u00famero de p\u00e1ginas debe ser mayor que cero.', isError: true });",
       "setMetaFeedback({ text: t('res.pagesInvalid'), isError: true });")
    patch(F, "setMetaFeedback({ text: res.error || 'No se pudieron actualizar los metadatos.', isError: true });",
       "setMetaFeedback({ text: res.error || t('res.metaFail'), isError: true });")
    patch(F, "setMetaFeedback({ text: prog.error || 'No se pudo actualizar el progreso.', isError: true });",
       "setMetaFeedback({ text: prog.error || t('res.progressFail'), isError: true });")
    patch(F, "setMetaFeedback({ text: 'Libro actualizado correctamente.' });",
       "setMetaFeedback({ text: t('res.bookUpdated') });")
    patch(F, '<p className="text-meta">Cargando recurso local\u2026</p>',
       '<p className="text-meta">{t(\'res.loading\')}</p>')
    rep_all(F, 'Volver a la Biblioteca', '{t(\'res.back\')}', expect=2)
    patch(F, "{error || 'Recurso no encontrado.'}", "{error || t('res.notFound')}")
    rep_all(F, "{GRAPH_NODE_LABELS[kind === 'resource' ? 'resource' : kind]}",
       "{graphNodeLabel(kind === 'resource' ? 'resource' : kind, effective)}", expect=2)
    patch(F, '<Play size={13} aria-hidden="true" /> Estudiar',
       '<Play size={13} aria-hidden="true" /> {t(\'res.study\')}')
    patch(F, '<Brain size={13} aria-hidden="true" /> Repasar',
       '<Brain size={13} aria-hidden="true" /> {t(\'res.review\')}')
    patch(F, '<ListChecks size={13} aria-hidden="true" /> Practicar',
       '<ListChecks size={13} aria-hidden="true" /> {t(\'res.practice\')}')
    patch(F, '<Sparkles size={13} aria-hidden="true" /> Generar tarjetas',
       '<Sparkles size={13} aria-hidden="true" /> {t(\'res.genCards\')}')
    patch(F, '<Sparkles size={13} aria-hidden="true" /> Explicar',
       '<Sparkles size={13} aria-hidden="true" /> {t(\'res.explain\')}')
    patch(F, 'title="Exportar el material educativo de este recurso como paquete JSON: temario y trabajo propuesto, sin tu progreso, notas ni sesiones"',
       'title={t(\'res.packageTitle\')}')
    patch(F, '<Download size={13} aria-hidden="true" /> Material</Button>',
       '<Download size={13} aria-hidden="true" /> {t(\'res.material\')}</Button>')
    patch(F, '<dt className="text-faint">Tipo</dt>', '<dt className="text-faint">{t(\'res.type\')}</dt>')
    patch(F, '<dt className="text-faint">Categor\u00eda</dt>', '<dt className="text-faint">{t(\'res.category\')}</dt>')
    patch(F, '<dt className="text-faint">Estado</dt>', '<dt className="text-faint">{t(\'res.status\')}</dt>')
    patch(F, '<dt className="flex items-center gap-1 text-faint"><User size={11} aria-hidden="true" /> Autor</dt>',
       '<dt className="flex items-center gap-1 text-faint"><User size={11} aria-hidden="true" /> {t(\'res.author\')}</dt>')
    patch(F, "<dd className=\"text-ink\">{book.author || 'No especificado'}</dd>",
       "<dd className=\"text-ink\">{book.author || t('dashboard.authorUnknown')}</dd>")
    patch(F, '<dt className="text-faint">Progreso de lectura</dt>',
       '<dt className="text-faint">{t(\'res.reading\')}</dt>')
    patch(F, '<dd className="text-ink">{book.current_page || 0} / {book.page_count} p\u00e1g ({book.reading_percentage}%)</dd>',
       '<dd className="text-ink">{t(\'res.pagesOf\', { cur: book.current_page || 0, total: book.page_count, pct: book.reading_percentage })}</dd>')
    patch(F, '<dt className="text-faint">Formato de origen</dt>',
       '<dt className="text-faint">{t(\'res.sourceFormat\')}</dt>')
    patch(F, '<dt className="flex items-center gap-1 text-faint"><Calendar size={11} aria-hidden="true" /> Importado</dt>',
       '<dt className="flex items-center gap-1 text-faint"><Calendar size={11} aria-hidden="true" /> {t(\'res.imported\')}</dt>')
    patch(F, 'Fragmentos de contenido indexados: <strong className="text-ink">{fragments.length}</strong>',
       '{t(\'res.indexed\', { n: fragments.length }).split(\'{n}\')[0]}<strong className="text-ink">{fragments.length}</strong>')
    patch(F, 'Indexaci\u00f3n sem\u00e1ntica local: opcional al importar; la b\u00fasqueda exacta siempre funciona sin embeddings.',
       '{t(\'res.semanticNote\')}')
    patch(F, '<span className="text-faint">Archivo original:</span>',
       '<span className="text-faint">{t(\'res.origFile\')}</span>')
    patch(F, 'Huella SHA-256:',
       '{t(\'res.sha\')}')
    patch(F, '<label className="sr-only" htmlFor="rd-author">Autor del libro</label>',
       '<label className="sr-only" htmlFor="rd-author">{t(\'res.authorSr\')}</label>')
    patch(F, 'placeholder="Autor"\n                    aria-label="Autor del libro"',
       'placeholder={t(\'res.authorPh\')}\n                    aria-label={t(\'res.authorSr\')}')
    patch(F, '<label className="sr-only" htmlFor="rd-pages">P\u00e1ginas totales</label>',
       '<label className="sr-only" htmlFor="rd-pages">{t(\'res.pagesTotal\')}</label>')
    patch(F, 'placeholder="P\u00e1ginas totales"\n                    aria-label="P\u00e1ginas totales"',
       'placeholder={t(\'res.pagesTotal\')}\n                    aria-label={t(\'res.pagesTotal\')}')
    patch(F, '<label className="sr-only" htmlFor="rd-current">P\u00e1gina actual</label>',
       '<label className="sr-only" htmlFor="rd-current">{t(\'res.currentPage\')}</label>')
    patch(F, 'placeholder="P\u00e1gina actual"\n                    aria-label="P\u00e1gina actual"',
       'placeholder={t(\'res.currentPage\')}\n                    aria-label={t(\'res.currentPage\')}')
    patch(F, '<Button size="sm" variant="quiet" onClick={() => setIsEditingBook(false)}>\n                    Cancelar\n                  </Button>',
       '<Button size="sm" variant="quiet" onClick={() => setIsEditingBook(false)}>\n                    {t(\'res.cancel\')}\n                  </Button>')
    patch(F, '<Check size={12} aria-hidden="true" /> Guardar',
       '<Check size={12} aria-hidden="true" /> {t(\'res.save\')}')
    patch(F, '<Edit3 size={12} aria-hidden="true" /> Editar metadatos y progreso',
       '<Edit3 size={12} aria-hidden="true" /> {t(\'res.editMeta\')}')
    patch(F, '<section className="rounded-xl border border-line bg-surface p-5 shadow-card" aria-label="Contenido indexado">',
       '<section className="rounded-xl border border-line bg-surface p-5 shadow-card" aria-label={t(\'res.indexedLabel\')}>')
    patch(F, 'Contenido indexado ({fragments.length})',
       '{t(\'res.indexedCount\', { n: fragments.length })}')
    patch(F, '<section className="rounded-xl border border-line bg-surface p-5 shadow-card" aria-label="Relacionado">',
       '<section className="rounded-xl border border-line bg-surface p-5 shadow-card" aria-label={t(\'res.relatedLabel\')}>')
    patch(F, 'Relacionado ({related.length})',
       '{t(\'res.relatedCount\', { n: related.length })}')
    patch(F, 'Sin relaciones registradas. Puedes a\u00f1adirlas desde el Grafo de Conocimiento.',
       '{t(\'res.noRelations\')}')
    patch(F, "const relationLabel = (GRAPH_RELATION_LABELS as Record<string, string>)[item.relation] || item.relation;",
       "const relationLabel = item.relation in GRAPH_RELATION_LABELS ? graphRelationLabel(item.relation as GraphRelationType, effective) : item.relation;")
    patch(F, '{GRAPH_NODE_LABELS[item.type]} \u00b7 {relationLabel}{item.derived ? \' (estructural)\' : \'\'}',
       '{graphNodeLabel(item.type, effective)} \u00b7 {relationLabel}{item.derived ? t(\'res.structural\') : \'\'}')


def analytics_view() -> None:
    F = "pages/AnalyticsView.tsx"
    patch(F,
"""import {
  ANALYTICS_RANGES,
  ANALYTICS_RANGE_LABELS,
  buildDailySeries,""",
"""import {
  ANALYTICS_RANGES,
  analyticsRangeLabel,
  buildDailySeries,""")
    patch(F,
"import { Badge, Button, EmptyState, Panel, cn } from '../components/ui/index.tsx';",
"import { Badge, Button, EmptyState, Panel, cn } from '../components/ui/index.tsx';\nimport { useLanguage } from '../hooks/useLanguage.ts';\nimport { translateKey } from '../i18n/dictionaries.ts';\nimport type { LanguageCode } from '../i18n/languages.ts';")
    patch(F,
"""function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}""",
"""function formatMinutes(total: number, lang: LanguageCode = 'es'): string {
  if (total < 60) return translateKey(lang, 'analytics.minUnit', { n: total });
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes > 0
    ? translateKey(lang, 'analytics.hourMin', { h: hours, m: minutes })
    : translateKey(lang, 'analytics.hourOnly', { h: hours });
}""")
    patch(F,
"""export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ courses, books, practiceWork }) => {
  const { day: localDay } = resolveLocalDay();""",
"""export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ courses, books, practiceWork }) => {
  const { day: localDay } = resolveLocalDay();
  const { t, effective } = useLanguage();""")
    patch(F, "setLoadError('No se pudo leer el historial de estudio local.');",
       "setLoadError(t('analytics.loadFail'));")
    patch(F,
"    () => (data ? buildDailySeries(data.sessions, range, localDay) : []),\n    [data, range, localDay]",
"    () => (data ? buildDailySeries(data.sessions, range, localDay, undefined, effective) : []),\n    [data, range, localDay, effective]")
    rep_all(F, '<h1 className="type-display text-ink">An\u00e1lisis</h1>',
       '<h1 className="type-display text-ink">{t(\'analytics.title\')}</h1>', expect=2)
    patch(F, 'Calculando tu historial de estudio\u2026', '{t(\'analytics.loadingSub\')}')
    patch(F, 'Qu\u00e9 ha ocurrido realmente en tu estudio. Solo datos medidos, sin puntuaciones inventadas.',
       '{t(\'analytics.subtitle\')}')
    patch(F, '<div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rango de tiempo">',
       '<div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t(\'analytics.rangeLabel\')}>')
    patch(F, '{ANALYTICS_RANGE_LABELS[option]}', '{analyticsRangeLabel(option, effective)}')
    patch(F, 'title="Sin actividad en este rango"',
       'title={t(\'analytics.emptyTitle\')}')
    patch(F, 'hint={`No hay sesiones de estudio registradas en los \u00faltimos ${ANALYTICS_RANGE_LABELS[range].toLowerCase()}. Cambia de rango o registra una sesi\u00f3n para ver tu an\u00e1lisis.`}',
       'hint={t(\'analytics.emptyHint\', { range: analyticsRangeLabel(range, effective).toLowerCase() })}')
    patch(F, '<section aria-label="Resumen del periodo"',
       '<section aria-label={t(\'analytics.periodLabel\')}')
    patch(F, 'Tiempo de estudio</p>', '{t(\'analytics.studyTime\')}</p>')
    patch(F, '? `${comparison.deltaMinutes} min m\u00e1s que el periodo anterior`',
       '? t(\'analytics.deltaUp\', { n: comparison.deltaMinutes })')
    patch(F, ": `${Math.abs(comparison.deltaMinutes)} min menos que el periodo anterior`",
       ": t('analytics.deltaDown', { n: Math.abs(comparison.deltaMinutes) })")
    patch(F, ": 'Sin periodo anterior comparable'}", ": t('analytics.noCompare')}")
    patch(F, 'D\u00edas activos</p>', '{t(\'analytics.activeDays\')}</p>')
    patch(F, "{overview.daysInRange ? `de ${overview.daysInRange} d\u00edas del rango` : 'de todo el historial'}",
       "{overview.daysInRange ? t('analytics.ofRange', { n: overview.daysInRange }) : t('analytics.ofHistory')}")
    patch(F, 'Sesiones completadas</p>', '{t(\'analytics.sessionsDone\')}</p>')
    patch(F, '{formatMinutes(overview.avgMinutesPerActiveDay)} por d\u00eda activo',
       '{t(\'analytics.perActiveDay\', { t: formatMinutes(overview.avgMinutesPerActiveDay, effective) })}')
    patch(F, 'Racha actual</p>', '{t(\'analytics.streak\')}</p>')
    patch(F, '<p className="mt-1 text-xl font-mono font-semibold text-ink">{overview.streakDays} d\u00edas</p>',
       '<p className="mt-1 text-xl font-mono font-semibold text-ink">{t(\'analytics.streakDays\', { n: overview.streakDays })}</p>')
    patch(F, 'd\u00edas consecutivos con estudio</p>', '{t(\'analytics.streakHint\')}</p>')
    patch(F, 'Tarjetas repasadas</p>', '{t(\'analytics.cards\')}</p>')
    patch(F, 'repasos SM-2 en el rango</p>', '{t(\'analytics.cardsHint\')}</p>')
    patch(F, 'Preguntas contestadas</p>', '{t(\'analytics.questions\')}</p>')
    patch(F, '<p className="text-micro text-faint">{overview.correctAnswers} correctas</p>',
       '<p className="text-micro text-faint">{t(\'analytics.correctN\', { n: overview.correctAnswers })}</p>')
    patch(F, 'Precisi\u00f3n</p>', '{t(\'analytics.accuracy\')}</p>')
    patch(F, "? 'sin preguntas en este rango'",
       "? t('analytics.noQuestions')")
    patch(F, ': `${overview.correctAnswers} de ${overview.questionsAnswered} correctas`}',
       ': t(\'analytics.scoreOf\', { ok: overview.correctAnswers, total: overview.questionsAnswered })}')
    patch(F, 'Evoluci\u00f3n diaria</h2>', '{t(\'analytics.dailyTitle\')}</h2>')
    patch(F, "{metric === 'minutes' ? 'Minutos de estudio por d\u00eda.' : '\u00cdtems repasados por d\u00eda (tarjetas + preguntas).'}",
       "{metric === 'minutes' ? t('analytics.minutesDesc') : t('analytics.reviewsDesc')}")
    patch(F, "{' '}Total del rango: <strong className=\"text-ink\">{metric === 'minutes' ? formatMinutes(chartTotal) : chartTotal}</strong>.",
       "{' '}{t('analytics.rangeTotal', { v: metric === 'minutes' ? formatMinutes(chartTotal, effective) : chartTotal })}")
    patch(F, '<div className="flex items-center gap-1 rounded-lg border border-line bg-canvas p-0.5" role="group" aria-label="M\u00e9trica a visualizar">',
       '<div className="flex items-center gap-1 rounded-lg border border-line bg-canvas p-0.5" role="group" aria-label={t(\'analytics.metricLabel\')}>')
    patch(F, 'Minutos\n                </button>', '{t(\'analytics.minutesBtn\')}\n                </button>')
    patch(F, '\u00cdtems\n                </button>', '{t(\'analytics.itemsBtn\')}\n                </button>')
    patch(F, 'Sin datos de actividad en este rango.</p>', '{t(\'analytics.noData\')}</p>')
    patch(F, 'title={`${point.label}: ${metric === \'minutes\' ? `${value} min` : `${value} \u00edtems`}`}',
       'title={metric === \'minutes\' ? t(\'analytics.barMin\', { label: point.label, v: value }) : t(\'analytics.barItems\', { label: point.label, v: value })}')
    patch(F, 'Ver los datos del gr\u00e1fico en tabla',
       '{t(\'analytics.tableToggle\')}')
    patch(F, """Actividad diaria del rango {ANALYTICS_RANGE_LABELS[range]}
                        {chartPoints.some(point => point.days > 1) ? ' (d\u00edas agrupados por l\u00edmite de pantalla)' : ''}""",
"""                      {t('analytics.tableCap', { range: analyticsRangeLabel(range, effective), grouped: chartPoints.some(point => point.days > 1) ? t('analytics.tableGrouped') : '' })}""")
    patch(F, '<th scope="col" className="py-1 pr-3 font-semibold">Fecha</th>',
       '<th scope="col" className="py-1 pr-3 font-semibold">{t(\'analytics.thDate\')}</th>')
    patch(F, '<th scope="col" className="py-1 pr-3 font-semibold">Minutos</th>',
       '<th scope="col" className="py-1 pr-3 font-semibold">{t(\'analytics.thMin\')}</th>')
    patch(F, '<th scope="col" className="py-1 font-semibold">\u00cdtems</th>',
       '<th scope="col" className="py-1 font-semibold">{t(\'analytics.thItems\')}</th>')
    patch(F, '{point.days > 1 ? ` (${point.days} d\u00edas)` : \'\'}',
       '{point.days > 1 ? t(\'analytics.daysN\', { n: point.days }) : \'\'}')
    patch(F, '<section aria-label="Progreso de contenido"',
       '<section aria-label={t(\'analytics.contentLabel\')}')
    patch(F, 'Cursos</p>', '{t(\'analytics.courses\')}</p>')
    patch(F, 'Ning\u00fan curso tiene lecciones registradas todav\u00eda.</p>', '{t(\'analytics.noLessons\')}</p>')
    patch(F, 'aria-label="Lecciones completadas sobre totales en todos tus cursos"',
       'aria-label={t(\'analytics.lessonsBar\')}')
    patch(F, '{content.courses.lessonsCompleted} de {content.courses.lessonsTotal} lecciones \u00b7{\' \'}\n                    {content.courses.completed} de {content.courses.total} cursos completados',
       '{t(\'analytics.lessonsOf\', { done: content.courses.lessonsCompleted, total: content.courses.lessonsTotal, c: content.courses.completed, t: content.courses.total })}')
    patch(F, 'Libros</p>', '{t(\'analytics.books\')}</p>')
    patch(F, 'Ning\u00fan libro tiene n\u00famero de p\u00e1ginas registrado.</p>', '{t(\'analytics.noPages\')}</p>')
    patch(F, 'aria-label="P\u00e1ginas le\u00eddas sobre totales en todos tus libros"',
       'aria-label={t(\'analytics.booksBar\')}')
    patch(F, '{content.books.pagesRead} de {content.books.pagesTotal} p\u00e1ginas \u00b7 {content.books.finished} terminados',
       '{t(\'analytics.booksOf\', { read: content.books.pagesRead, total: content.books.pagesTotal, done: content.books.finished })}')
    patch(F, 'Trabajo pr\u00e1ctico</p>', '{t(\'analytics.practice\')}</p>')
    patch(F, 'aria-label="Trabajos pr\u00e1cticos terminados sobre los registrados"',
       'aria-label={t(\'analytics.practiceBar\')}')
    patch(F, '{content.practice.done} de {content.practice.total} terminados \u00b7 {content.practice.inProgress} en marcha',
       '{t(\'analytics.practiceOf\', { done: content.practice.done, total: content.practice.total, n: content.practice.inProgress })}')
    patch(F, 'Actividad por recurso</h2>', '{t(\'analytics.byResource\')}</h2>')
    patch(F, 'D\u00f3nde se ha concentrado tu estudio en el rango seleccionado.</p>',
       '{t(\'analytics.byResourceSub\')}</p>')
    patch(F, 'Sin actividad registrada en este rango.</p>', '{t(\'analytics.noActivity\')}</p>')
    patch(F, '{formatMinutes(row.minutes)} \u00b7 {row.reviews} \u00edtems \u00b7 {row.sessions} sesiones',
       '{t(\'analytics.rowMeta\', { t: formatMinutes(row.minutes, effective), r: row.reviews, s: row.sessions })}')
    patch(F, 'Actividad reciente</h2>', '{t(\'analytics.recent\')}</h2>')
    patch(F, 'Las \u00faltimas sesiones completadas, tal como se registraron.</p>',
       '{t(\'analytics.recentSub\')}</p>')
    patch(F, 'Todav\u00eda no hay sesiones completadas.</p>', '{t(\'analytics.noSessions\')}</p>')
    patch(F, "{session.resource_title || session.lesson_title || 'Estudio general'}",
       "{session.resource_title || session.lesson_title || t('analytics.general')}")
    patch(F, "{day ?? 'fecha no legible'} \u00b7 {formatMinutes(session.duration_minutes)}",
       "{day ?? t('analytics.badDate')} \u00b7 {formatMinutes(session.duration_minutes, effective)}")
    patch(F, '{session.cards_reviewed} tarjetas</Badge>',
       '{t(\'analytics.cardsN\', { n: session.cards_reviewed })}</Badge>')
    patch(F, '{session.correct_answers}/{session.questions_answered} correctas',
       '{t(\'analytics.correctPair\', { ok: session.correct_answers, total: session.questions_answered })}')
    rep_all(F, 'formatMinutes(overview.studyMinutes)', 'formatMinutes(overview.studyMinutes, effective)', expect=1)


def knowledge_graph() -> None:
    F = "pages/KnowledgeGraph.tsx"
    patch(F,
"import { practiceWorkKindLabel } from '../services/practiceWork.ts';",
"import { practiceWorkKindLabel } from '../services/practiceWork.ts';\nimport { useLanguage } from '../hooks/useLanguage.ts';")
    patch(F,
"""import {
  GRAPH_NODE_LABELS,
  GRAPH_RELATION_LABELS,
  GRAPH_RELATION_TYPES,""",
"""import {
  GRAPH_RELATION_LABELS,
  GRAPH_RELATION_TYPES,
  graphNodeLabel,
  graphRelationLabel,""")
    patch(F,
"import { ConceptNode, ConceptEdge, GraphNodeType } from '../types/models.ts';",
"import { ConceptNode, ConceptEdge, GraphNodeType, GraphRelationType } from '../types/models.ts';")
    patch(F,
"""  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);""",
"""  const { t: tr, effective } = useLanguage();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);""")
    patch(F,
"""      setLoadError(
        failure?.message ||
          'No se pudo cargar el grafo de conocimiento local. Vuelve a abrir esta secci\u00f3n o recarga la aplicaci\u00f3n.'
      );""",
"""      setLoadError(
        failure?.message ||
          tr('graph.loadFail')
      );""")
    patch(F, "  const insights = useMemo(() => buildGraphInsights(analytics), [analytics]);",
       "  const insights = useMemo(() => buildGraphInsights(analytics, effective), [analytics, effective]);")
    patch(F, "        title: n.description || GRAPH_NODE_LABELS[type],",
       "        title: n.description || graphNodeLabel(type as GraphNodeType, effective),")
    patch(F, "      label: (GRAPH_RELATION_LABELS as Record<string, string>)[e.connection_type] || e.connection_type,",
       "      label: e.connection_type in GRAPH_RELATION_LABELS ? graphRelationLabel(e.connection_type as GraphRelationType, effective) : e.connection_type,")
    patch(F, "  }, [visibleGraph, theme]);",
       "  }, [visibleGraph, theme, effective]);")
    patch(F,
"""  const navigationLabel = selectedNode
    ? GRAPH_NODE_LABELS[(selectedNode.node_type || 'resource')]
    : 'nodo';""",
"""  const navigationLabel = selectedNode
    ? graphNodeLabel((selectedNode.node_type || 'resource') as GraphNodeType, effective)
    : tr('graph.nodeGeneric');""")
    patch(F, "        setConnectionError(res.error || 'No se pudo crear la conexi\u00f3n.');",
       "        setConnectionError(res.error || tr('graph.connFail'));")
    patch(F, "      setConnectionError(err?.message || 'Error al guardar la conexi\u00f3n.');",
       "      setConnectionError(err?.message || tr('graph.saveFail'));")
    patch(F, "      relationLabel: (GRAPH_RELATION_LABELS as Record<string, string>)[edge.connection_type] || edge.connection_type",
       "      relationLabel: edge.connection_type in GRAPH_RELATION_LABELS ? graphRelationLabel(edge.connection_type as GraphRelationType, effective) : edge.connection_type")
    patch(F, '<h1 className="type-display text-ink">Grafo de conocimiento</h1>',
       '<h1 className="type-display text-ink">{tr(\'graph.title\')}</h1>')
    patch(F, """Explora c\u00f3mo se relaciona lo que estudias. Cursos, libros, m\u00f3dulos, lecciones, notas,
            conceptos, trabajo pr\u00e1ctico y recursos, con relaciones expl\u00edcitas guardadas en SQLite.""",
       "{tr('graph.subtitle')}")
    patch(F, 'title="Exportar imagen del grafo actual en formato PNG de alta resoluci\u00f3n"',
       'title={tr(\'graph.exportTitle\')}')
    patch(F, '<Download size={14} aria-hidden="true" /> Exportar PNG',
       '<Download size={14} aria-hidden="true" /> {tr(\'graph.exportPng\')}')
    patch(F, '<Plus size={15} aria-hidden="true" /> A\u00f1adir conexi\u00f3n',
       '<Plus size={15} aria-hidden="true" /> {tr(\'graph.addConn\')}')
    patch(F, '<BarChart3 size={14} aria-hidden="true" /> Estad\u00edsticas',
       '<BarChart3 size={14} aria-hidden="true" /> {tr(\'graph.stats\')}')
    patch(F, '<div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtros de nodos del grafo">',
       '<div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tr(\'graph.nodeFilters\')}>')
    patch(F, '              Todos\n            </Chip>', '              {tr(\'graph.all\')}\n            </Chip>')
    rep_all(F, '{GRAPH_NODE_LABELS[type]}', '{graphNodeLabel(type, effective)}', expect=2)
    patch(F, '<div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtros de relaciones del grafo">',
       '<div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tr(\'graph.relFilters\')}>')
    patch(F, '<span className="type-micro text-faint">Relaciones</span>',
       '<span className="type-micro text-faint">{tr(\'graph.rels\')}</span>')
    patch(F, '                Todas\n              </Chip>', '                {tr(\'graph.allF\')}\n              </Chip>')
    patch(F, '{(GRAPH_RELATION_LABELS as Record<string, string>)[relation] || relation}',
       '{relation in GRAPH_RELATION_LABELS ? graphRelationLabel(relation as GraphRelationType, effective) : relation}')
    patch(F, 'placeholder="Buscar y centrar nodo\u2026"',
       'placeholder={tr(\'graph.searchPh\')}')
    patch(F, 'aria-label="Buscar y centrar nodo en el grafo"',
       'aria-label={tr(\'graph.searchPh\')}')
    patch(F, 'Sin coincidencias.</p>', '{tr(\'graph.noMatch\')}</p>')
    patch(F, 'Construyendo el grafo local desde SQLite\u2026</p>', '{tr(\'graph.building\')}</p>')
    patch(F, 'A\u00fan no hay nodos en el grafo</p>', '{tr(\'graph.emptyTitle\')}</p>')
    patch(F, 'Crea cursos, libros, notas o conceptos para empezar a organizar tu conocimiento.',
       '{tr(\'graph.emptyHint\')}')
    patch(F, 'Los filtros actuales ocultan todos los nodos.</p>', '{tr(\'graph.filtersHide\')}</p>')
    patch(F, """Arrastra y haz zoom. Las aristas discontinuas son estructurales; las s\u00f3lidas son
                conexiones tuyas.""",
       "{tr('graph.legendMain')}")
    patch(F, '{connectivity.connected}/{connectivity.total} nodos con conexiones en el grafo completo',
       '{tr(\'graph.legendConn\', { a: connectivity.connected, b: connectivity.total })}')
    patch(F, "{connectivity.isolated > 0 ? ` \u00b7 ${connectivity.isolated} sin ninguna relaci\u00f3n` : ''}",
       "{connectivity.isolated > 0 ? tr('graph.legendIso', { n: connectivity.isolated }) : ''}")
    patch(F, """{isolation.apparentlyIsolated}{' '}
                  {isolation.apparentlyIsolated === 1 ? 'nodo aparece aislado' : 'nodos aparecen aislados'} en
                  esta vista porque un filtro oculta sus relaciones; en el grafo completo s\u00ed est\u00e1n conectados.""",
"""{isolation.apparentlyIsolated === 1 ? tr('graph.legendViewOne', { n: isolation.apparentlyIsolated }) : tr('graph.legendViewOther', { n: isolation.apparentlyIsolated })}{tr('graph.legendViewWhy')}""")
    patch(F, '<p className="type-meta">{GRAPH_NODE_LABELS[(selectedNode.node_type || \'resource\')]}</p>',
       '<p className="type-meta">{graphNodeLabel((selectedNode.node_type || \'resource\') as GraphNodeType, effective)}</p>')
    patch(F, 'aria-label="Enfoque del vecindario del nodo seleccionado"',
       'aria-label={tr(\'graph.focusSr\')}')
    patch(F, '                  Grafo completo\n                </Chip>', '                  {tr(\'graph.fullGraph\')}\n                </Chip>')
    patch(F, '                  Solo vecinos\n                </Chip>', '                  {tr(\'graph.neighbors\')}\n                </Chip>')
    patch(F, '                  2 saltos\n                </Chip>', '                  {tr(\'graph.hops2\')}\n                </Chip>')
    patch(F, '<dt className="text-faint">Categor\u00eda</dt>', '<dt className="text-faint">{tr(\'graph.metaCat\')}</dt>')
    patch(F, '<dt className="text-faint">Estado</dt>', '<dt className="text-faint">{tr(\'graph.metaStatus\')}</dt>')
    patch(F, '<dt className="text-faint">Autor</dt>', '<dt className="text-faint">{tr(\'graph.metaAuthor\')}</dt>')
    patch(F, '<dt className="text-faint">Instructor</dt>', '<dt className="text-faint">{tr(\'graph.metaInstructor\')}</dt>')
    patch(F, '<><dt className="text-faint">P\u00e1ginas</dt>', '<><dt className="text-faint">{tr(\'graph.metaPages\')}</dt>')
    patch(F, '<><dt className="text-faint">Duraci\u00f3n</dt><dd className="text-ink">{selectedNode.meta.duration_minutes} min</dd>',
       '<><dt className="text-faint">{tr(\'graph.metaDur\')}</dt><dd className="text-ink">{tr(\'graph.minShort\', { n: selectedNode.meta.duration_minutes })}</dd>')
    patch(F, '<><dt className="text-faint">Tipo</dt><dd className="text-ink">{practiceWorkKindLabel(selectedNode.meta.practice_kind)}</dd>',
       '<><dt className="text-faint">{tr(\'graph.metaType\')}</dt><dd className="text-ink">{practiceWorkKindLabel(selectedNode.meta.practice_kind, effective)}</dd>')
    patch(F, '<dt className="text-faint">Etiquetas</dt>', '<dt className="text-faint">{tr(\'graph.metaTags\')}</dt>')
    patch(F, '<h3 className="type-micro mb-1.5">Relaciones ({relatedList.length})</h3>',
       '<h3 className="type-micro mb-1.5">{tr(\'graph.relsCount\', { n: relatedList.length })}</h3>')
    patch(F, 'Sin relaciones registradas.</p>', '{tr(\'graph.noRels\')}</p>')
    patch(F, '{GRAPH_NODE_LABELS[counterpartType]}',
       '{graphNodeLabel(counterpartType, effective)}')
    patch(F, "onClick={() => setPendingDeleteEdge({ id: edge.id, label: `${relationLabel} con ${counterpartName}` })}",
       "onClick={() => setPendingDeleteEdge({ id: edge.id, label: tr('graph.connWith', { rel: relationLabel, name: counterpartName }) })}")
    patch(F, 'title="Eliminar conexi\u00f3n"',
       'title={tr(\'graph.deleteConn\')}')
    patch(F, 'aria-label={`Eliminar conexi\u00f3n ${relationLabel} con ${counterpartName}`}',
       'aria-label={tr(\'graph.deleteConnSr\', { rel: relationLabel, name: counterpartName })}')
    patch(F, '<ArrowUpRight size={13} aria-hidden="true" /> Abrir {navigationLabel}',
       '<ArrowUpRight size={13} aria-hidden="true" /> {tr(\'graph.open\', { label: navigationLabel })}')
    patch(F, '<Lightbulb size={13} aria-hidden="true" /> Estudiar',
       '<Lightbulb size={13} aria-hidden="true" /> {tr(\'graph.study\')}')
    patch(F, 'Selecciona un nodo para ver su tipo, metadatos y relaciones.</p>',
       '{tr(\'graph.selectNode\')}</p>')
    patch(F, 'La lista textual de relaciones est\u00e1 disponible aqu\u00ed para lectores de pantalla.',
       '{tr(\'graph.srList\')}')
    patch(F, 'aria-label="Estad\u00edsticas estructurales del grafo"',
       'aria-label={tr(\'graph.statsSr\')}')
    patch(F, 'Estad\u00edsticas del grafo</h2>', '{tr(\'graph.statsTitle\')}</h2>')
    patch(F, """Propiedades estructurales de tus datos. Las conexiones indican relaciones, no
              importancia ni dominio.""",
       "{tr('graph.statsSub')}")
    patch(F, '<dt className="type-micro text-muted">Nodos</dt>', '<dt className="type-micro text-muted">{tr(\'graph.stNodes\')}</dt>')
    patch(F, '<dt className="type-micro text-muted">Con conexiones</dt>', '<dt className="type-micro text-muted">{tr(\'graph.stConnected\')}</dt>')
    patch(F, '<dt className="type-micro text-muted">Sin ninguna relaci\u00f3n</dt>', '<dt className="type-micro text-muted">{tr(\'graph.stIsolated\')}</dt>')
    patch(F, '<dt className="type-micro text-muted">Relaciones</dt>', '<dt className="type-micro text-muted">{tr(\'graph.stEdges\')}</dt>')
    patch(F, '<dt className="type-micro text-muted">Grupos separados</dt>', '<dt className="type-micro text-muted">{tr(\'graph.stGroups\')}</dt>')
    patch(F, 'Lectura del grafo</h3>', '{tr(\'graph.reading\')}</h3>')
    patch(F, 'M\u00e1s conectados</h3>', '{tr(\'graph.top\')}</h3>')
    patch(F, 'Ning\u00fan nodo tiene conexiones todav\u00eda.</p>', '{tr(\'graph.topEmpty\')}</p>')
    patch(F, '{GRAPH_NODE_LABELS[entry.type]} \u00b7 {entry.degree} conexiones',
       '{tr(\'graph.topMeta\', { type: graphNodeLabel(entry.type, effective), n: entry.degree })}')
    patch(F, 'Poco conectados</h3>', '{tr(\'graph.weak\')}</h3>')
    patch(F, 'Todos los recursos tienen conexiones.</p>', '{tr(\'graph.weakEmpty\')}</p>')
    patch(F, "{entry.degree} {entry.degree === 1 ? 'conexi\u00f3n' : 'conexiones'}",
       "{entry.degree === 1 ? tr('graph.weakOne', { n: entry.degree }) : tr('graph.weakOther', { n: entry.degree })}")
    patch(F, 'Conocimiento reciente</h3>', '{tr(\'graph.recentK\')}</h3>')
    patch(F, 'Tus nodos no exponen fechas de creaci\u00f3n, as\u00ed que no se muestra actividad reciente.',
       '{tr(\'graph.recentNoDates\')}')
    patch(F, 'Sin fechas recientes registradas.</p>', '{tr(\'graph.recentEmpty\')}</p>')
    patch(F, '{GRAPH_NODE_LABELS[entry.type]} \u00b7 {entry.date}',
       '{tr(\'graph.topMeta\', { type: graphNodeLabel(entry.type, effective), n: entry.date })}')
    rep_all(F, "describeDestructiveAction('delete-connection', pendingDeleteEdge?.label || '')",
       "describeDestructiveAction('delete-connection', pendingDeleteEdge?.label || '', effective)", expect=3)
    patch(F, '<Link2 size={16} className="text-accent" aria-hidden="true" /> A\u00f1adir conexi\u00f3n',
       '<Link2 size={16} className="text-accent" aria-hidden="true" /> {tr(\'graph.connTitle\')}')
    patch(F, 'aria-label="Cerrar di\u00e1logo"', 'aria-label={tr(\'graph.closeDialog\')}')
    patch(F, 'htmlFor="conn-source">Desde</label>', 'htmlFor="conn-source">{tr(\'graph.from\')}</label>')
    rep_all(F, '<option value="">-- Elige un nodo --</option>',
       '<option value="">{tr(\'graph.chooseNode\')}</option>', expect=2)
    rep_all(F, '{GRAPH_NODE_LABELS[(n.node_type || \'resource\')]} \u00b7 {n.name}',
       '{graphNodeLabel((n.node_type || \'resource\') as GraphNodeType, effective)} \u00b7 {n.name}', expect=2)
    patch(F, 'htmlFor="conn-relation">Relaci\u00f3n</label>', 'htmlFor="conn-relation">{tr(\'graph.relation\')}</label>')
    patch(F, '{GRAPH_RELATION_LABELS[r]}', '{graphRelationLabel(r, effective)}')
    patch(F, 'htmlFor="conn-target">Hacia</label>', 'htmlFor="conn-target">{tr(\'graph.to\')}</label>')
    patch(F, '                Cancelar\n              </Button>', '                {tr(\'graph.cancel\')}\n              </Button>')
    patch(F, "{isSavingConnection ? 'Guardando\u2026' : 'Guardar conexi\u00f3n'}",
       "{isSavingConnection ? tr('graph.saving') : tr('graph.saveConn')}")


def dashboard_series() -> None:
    patch("pages/Dashboard.tsx",
"      .getDailyActivitySeries(timeRange)",
"      .getDailyActivitySeries(timeRange, effective)")
    patch("pages/Dashboard.tsx",
"    return () => {\n      cancelled = true;\n    };\n  }, [timeRange, kpis]);",
"    return () => {\n      cancelled = true;\n    };\n  }, [timeRange, kpis, effective]);")


if __name__ == "__main__":
    add_extra_keys()
    goals_view()
    notes_view()
    resource_detail()
    analytics_view()
    knowledge_graph()
    dashboard_series()
    print("OK s2d")
