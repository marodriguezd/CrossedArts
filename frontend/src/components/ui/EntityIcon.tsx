import React from 'react';
import {
  GraduationCap,
  BookOpen,
  Layers,
  FileText,
  ClipboardList,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react';
import type { GraphNodeType } from '../../types/models.ts';

export const ENTITY_ICONS: Record<GraphNodeType, LucideIcon> = {
  course: GraduationCap,
  book: BookOpen,
  module: Layers,
  lesson: FileText,
  note: FileText,
  practice: ClipboardList,
  concept: Lightbulb,
  resource: BookOpen,
};

export interface EntityIconProps {
  type: GraphNodeType;
  size?: number;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}

export const EntityIcon: React.FC<EntityIconProps> = ({
  type,
  size = 16,
  className,
  'aria-hidden': ariaHidden = true,
}) => {
  const Icon = ENTITY_ICONS[type] ?? BookOpen;
  return <Icon size={size} className={className} aria-hidden={ariaHidden} />;
};
