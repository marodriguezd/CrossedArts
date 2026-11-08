import React from 'react';
import { Plus, FileUp, FolderOpen, Loader2 } from 'lucide-react';
import { Button, Chip, SearchInput } from '../ui/index.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';

export type LibraryFilterMode = 'all' | 'courses' | 'books';

export interface CatalogFilterBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  filter: LibraryFilterMode;
  onFilterChange: (f: LibraryFilterMode) => void;
  onCreateCourse: () => void;
  onImportDocuments: () => void;
  onMountLocalFolder: () => void;
  isImporting: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFilesSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  children?: React.ReactNode;
}

export const CatalogFilterBar: React.FC<CatalogFilterBarProps> = ({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  onCreateCourse,
  onImportDocuments,
  onMountLocalFolder,
  isImporting,
  fileInputRef,
  onFilesSelected,
  children,
}) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-display text-ink">Biblioteca</h1>
          <p className="type-secondary mt-1">
            Explora y organiza todos tus recursos de aprendizaje.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Hidden file-selection input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFilesSelected}
            multiple
            accept=".txt,.md,.markdown,.pdf,.epub"
            className="hidden"
          />

          <Button
            variant="outline"
            onClick={onCreateCourse}
            title="Crear un curso estructurado"
          >
            <Plus size={15} aria-hidden="true" />
            Crear curso
          </Button>

          <Button
            variant="outline"
            onClick={onImportDocuments}
            disabled={isImporting}
            title="Importar documentos locales (.txt, .md, .pdf, .epub)"
          >
            {isImporting ? (
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            ) : (
              <FileUp size={15} aria-hidden="true" />
            )}
            {isImporting ? 'Importando…' : 'Importar documentos'}
          </Button>

          <Button
            variant="outline"
            onClick={onMountLocalFolder}
            title="Escanear carpeta local con File System Access API"
          >
            <FolderOpen size={15} aria-hidden="true" />
            Vincular carpeta local
          </Button>
        </div>
      </div>

      {children}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          label={t('library.searchLabel')}
          placeholder={t('library.searchPlaceholder')}
          value={query}
          onChange={onQueryChange}
          className="sm:w-80"
        />
        <div className="flex items-center gap-1.5" role="group" aria-label="Filtrar por tipo">
          {(['all', 'courses', 'books'] as const).map((mode) => (
            <Chip key={mode} active={filter === mode} onClick={() => onFilterChange(mode)}>
              {mode === 'all' ? 'Todo' : mode === 'courses' ? 'Cursos' : 'Libros'}
            </Chip>
          ))}
        </div>
      </div>
    </div>
  );
};
