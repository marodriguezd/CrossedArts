from typing import Dict, Any
from sqlalchemy import select, func, desc, and_
from sqlalchemy.orm import Session
from datetime import timedelta
from backend.app.core.utils import utc_now_naive

from backend.app.models.resource import LearningResource
from backend.app.models.activity import LearningSession, Note
from backend.app.models.base import ResourceStatus
from backend.app.models.knowledge import Concept, KnowledgeConnection
from backend.app.models.workflow import ReviewItem, ReviewHistory

class LearningInsightsService:
    @staticmethod
    def get_concept_mastery_and_gaps(db: Session) -> Dict[str, Any]:
        """
        Calcula la puntuación de maestría (0-100) y clasifica brechas de conocimiento
        para todos los conceptos del sistema basándose en notas, repasos y sesiones.
        Optimizado para evitar el problema N+7 queries pre-cargando los datos.
        """
        concepts = db.scalars(select(Concept)).all()
        
        mastery_list = []
        gaps = {
            "never_reviewed": [],
            "rarely_studied": [],
            "weak_concepts": [],
            "forgotten_concepts": []
        }
        
        now = utc_now_naive()

        # 1. Pre-cargar conexiones notas -> conceptos
        stmt_all_note_conns = select(KnowledgeConnection.target_id, KnowledgeConnection.source_id).where(
            and_(
                KnowledgeConnection.target_type == "concept",
                KnowledgeConnection.source_type == "note"
            )
        )
        note_conns = db.execute(stmt_all_note_conns).all()
        concept_to_notes = {}
        for target_id, source_id in note_conns:
            concept_to_notes.setdefault(target_id, []).append(source_id)

        # 2. Pre-cargar conexiones recursos <-> conceptos
        stmt_res1 = select(KnowledgeConnection.source_id, KnowledgeConnection.target_id).where(
            and_(
                KnowledgeConnection.source_type == "concept",
                KnowledgeConnection.target_type == "resource"
            )
        )
        stmt_res2 = select(KnowledgeConnection.target_id, KnowledgeConnection.source_id).where(
            and_(
                KnowledgeConnection.target_type == "concept",
                KnowledgeConnection.source_type == "resource"
            )
        )
        res_conns1 = db.execute(stmt_res1).all()
        res_conns2 = db.execute(stmt_res2).all()
        
        concept_to_resources = {}
        for source_id, target_id in res_conns1:
            concept_to_resources.setdefault(source_id, set()).add(target_id)
        for target_id, source_id in res_conns2:
            concept_to_resources.setdefault(target_id, set()).add(source_id)

        # 3. Pre-cargar mapeo de notas a sus recursos
        all_notes_data = db.execute(select(Note.id, Note.resource_id)).all()
        note_id_to_resource_id = {nid: rid for nid, rid in all_notes_data}

        # 4. Pre-cargar minutos de estudio acumulados por recurso
        stmt_sessions = select(LearningSession.resource_id, func.sum(LearningSession.duration_minutes)).group_by(LearningSession.resource_id)
        sessions_durations = {rid: (dur or 0) for rid, dur in db.execute(stmt_sessions).all()}

        # 5. Consultas SQL agregadas de SQLAlchemy para agrupar y calcular resúmenes de ReviewItems y ReviewHistory
        stmt_reviews = (
            select(
                ReviewItem.note_id,
                func.count(ReviewItem.id).label("count"),
                func.sum(ReviewItem.repetitions).label("sum_repetitions"),
                func.sum(ReviewItem.easiness_factor).label("sum_easiness"),
                func.min(ReviewItem.next_review).label("min_next_review")
            )
            .where(ReviewItem.note_id.isnot(None))
            .group_by(ReviewItem.note_id)
        )
        reviews_stats = {}
        for row in db.execute(stmt_reviews).all():
            reviews_stats[row.note_id] = {
                "count": row.count or 0,
                "sum_repetitions": row.sum_repetitions or 0,
                "sum_easiness": row.sum_easiness or 0.0,
                "min_next_review": row.min_next_review
            }

        # 6. Consultas SQL agregadas para obtener historial de calidades agrupado por note_id
        stmt_history = (
            select(
                ReviewItem.note_id,
                func.sum(ReviewHistory.quality).label("sum_quality"),
                func.count(ReviewHistory.id).label("count_quality")
            )
            .join(ReviewHistory, ReviewHistory.review_item_id == ReviewItem.id)
            .where(ReviewItem.note_id.isnot(None))
            .group_by(ReviewItem.note_id)
        )
        history_stats = {}
        for row in db.execute(stmt_history).all():
            history_stats[row.note_id] = {
                "sum_quality": row.sum_quality or 0.0,
                "count_quality": row.count_quality or 0
            }

        for c in concepts:
            # 1. Obtener notas asociadas
            note_ids = concept_to_notes.get(c.id, [])
            note_count = len(note_ids)
            
            # 2. Recursos vinculados
            res_ids = set(concept_to_resources.get(c.id, set()))
            for nid in note_ids:
                rid = note_id_to_resource_id.get(nid)
                if rid:
                    res_ids.add(rid)
                
            # 3. Minutos de estudio
            total_study_minutes = sum(sessions_durations.get(rid, 0) for rid in res_ids)
                
            # 4. Datos de Repasos (SM-2) a partir de las estadísticas pre-agregadas
            total_reviews_count = 0
            total_repetitions = 0.0
            total_easiness = 0.0
            min_next_review = None
            
            for nid in note_ids:
                if nid in reviews_stats:
                    stats = reviews_stats[nid]
                    total_reviews_count += stats["count"]
                    total_repetitions += stats["sum_repetitions"]
                    total_easiness += stats["sum_easiness"]
                    if stats["min_next_review"]:
                        if min_next_review is None or stats["min_next_review"] < min_next_review:
                            min_next_review = stats["min_next_review"]
            
            avg_repetitions = 0.0
            avg_easiness = 2.5
            avg_quality = 3.0
            is_overdue_long = False
            has_reviews = total_reviews_count > 0
            
            if has_reviews:
                avg_repetitions = total_repetitions / total_reviews_count
                avg_easiness = total_easiness / total_reviews_count
                
                # Obtener calidad histórica agregada
                total_qual_sum = 0.0
                total_qual_count = 0
                for nid in note_ids:
                    if nid in history_stats:
                        total_qual_sum += history_stats[nid]["sum_quality"]
                        total_qual_count += history_stats[nid]["count_quality"]
                
                if total_qual_count > 0:
                    avg_quality = total_qual_sum / total_qual_count
                    
                # Comprobar si está muy atrasado (más de 2 días)
                if min_next_review:
                    is_overdue_long = (min_next_review + timedelta(days=2)) <= now
                
            # 5. Fórmulas de puntuación de maestría
            notes_score = min(30, note_count * 10)
            sessions_score = min(30, total_study_minutes * 1.5)
            reviews_score = min(40, avg_repetitions * 5 + avg_quality * 5)
            
            mastery = min(100, int(notes_score + sessions_score + reviews_score))
            
            concept_info = {
                "id": c.id,
                "name": c.name,
                "mastery_score": mastery,
                "note_count": note_count,
                "study_minutes": total_study_minutes
            }
            mastery_list.append(concept_info)
            
            # Clasificación de brechas (Gaps)
            if note_count > 0 and not has_reviews:
                gaps["never_reviewed"].append(concept_info)
            if total_study_minutes < 15:
                gaps["rarely_studied"].append(concept_info)
            if has_reviews and (avg_quality < 3.0 or avg_easiness < 2.0):
                gaps["weak_concepts"].append(concept_info)
            if has_reviews and is_overdue_long:
                gaps["forgotten_concepts"].append(concept_info)
                
        return {"mastery": mastery_list, "gaps": gaps}

    @staticmethod
    def generate_insights(db: Session) -> Dict[str, Any]:
        """
        Genera un informe analítico detallado sobre patrones de estudio,
        conceptos de maestría, brechas de conocimiento y recomendaciones para CrossedArts v1.
        """
        # 1. Categorías más estudiadas
        stmt_studied = (
            db.query(LearningResource.category, func.count(LearningResource.id))
            .where(LearningResource.status.in_([ResourceStatus.IN_PROGRESS, ResourceStatus.COMPLETED]))
            .group_by(LearningResource.category)
            .order_by(desc(func.count(LearningResource.id)))
            .limit(3)
        )
        top_categories = [{"category": row[0], "count": row[1]} for row in stmt_studied.all()]

        # 2. Recursos desatendidos
        stmt_neglected = (
            select(LearningResource)
            .where(LearningResource.status == ResourceStatus.IN_PROGRESS)
            .order_by(LearningResource.updated_at.asc())
            .limit(3)
        )
        neglected = db.scalars(stmt_neglected).all()
        neglected_list = [
            {
                "id": r.id,
                "title": r.title,
                "type": r.type,
                "last_active": r.updated_at.strftime("%Y-%m-%d")
            }
            for r in neglected
        ]

        # 3. Próximo recurso recomendado (tema favorito)
        recommended_next = None
        if top_categories:
            fav_cat = top_categories[0]["category"]
            stmt_rec = (
                select(LearningResource)
                .where(
                    LearningResource.status == ResourceStatus.NOT_STARTED,
                    LearningResource.category == fav_cat
                )
                .limit(1)
            )
            recommended_next = db.scalars(stmt_rec).first()

        # 4. Sesión de repaso recomendada (Recursos con notas)
        stmt_review = (
            db.query(Note.resource_id, func.count(Note.id))
            .group_by(Note.resource_id)
            .order_by(desc(func.count(Note.id)))
            .limit(1)
        )
        review_row = stmt_review.first()
        recommended_review = None
        if review_row:
            res = db.get(LearningResource, review_row[0])
            if res:
                recommended_review = {
                    "id": res.id,
                    "title": res.title,
                    "type": res.type,
                    "notes_count": review_row[1]
                }

        # 5. Patrón de estudio reciente
        seven_days_ago = utc_now_naive() - timedelta(days=7)
        stmt_sessions = (
            select(func.sum(LearningSession.duration_minutes))
            .where(LearningSession.started_at >= seven_days_ago)
        )
        total_minutes = db.scalar(stmt_sessions) or 0

        # 6. Maestría e Inteligencia de Conocimiento
        knowledge_intel = LearningInsightsService.get_concept_mastery_and_gaps(db)

        # 7. Construir recomendaciones de v1 personalizadas
        recommendations = {
            "what_to_study": [],
            "what_to_review": [],
            "what_is_forgotten": []
        }
        
        # Agregar recursos desatendidos
        for r in neglected_list[:2]:
            recommendations["what_to_study"].append(f"Retoma tu estudio en '{r['title']}' (no lo has actualizado recientemente).")
            
        # Recomendaciones de brechas
        for c in knowledge_intel["gaps"]["never_reviewed"][:2]:
            recommendations["what_to_review"].append(f"Crea una tarjeta de repaso para el concepto #{c['name']} (nunca ha sido repasado).")
            
        for c in knowledge_intel["gaps"]["forgotten_concepts"][:2]:
            recommendations["what_is_forgotten"].append(f"El concepto #{c['name']} requiere repaso inmediato (está programado con atraso).")
            
        for c in knowledge_intel["gaps"]["weak_concepts"][:2]:
            recommendations["what_to_review"].append(f"Realiza una autoevaluación extra del concepto débil #{c['name']}.")

        return {
            "top_categories": top_categories,
            "neglected_resources": neglected_list,
            "recommended_next": {
                "id": recommended_next.id,
                "title": recommended_next.title,
                "type": recommended_next.type,
                "category": recommended_next.category
            } if recommended_next else None,
            "recommended_review_session": recommended_review,
            "recent_weekly_study_minutes": total_minutes,
            "concept_mastery": knowledge_intel["mastery"],
            "knowledge_gaps": knowledge_intel["gaps"],
            "detailed_recommendations": recommendations
        }
