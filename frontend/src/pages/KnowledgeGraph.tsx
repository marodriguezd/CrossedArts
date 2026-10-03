import React, { useEffect, useRef } from 'react';
import { ConceptNode, ConceptEdge } from '../types/models.ts';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import { Share2, Info } from 'lucide-react';

interface KnowledgeGraphProps {
  graphData: { nodes: ConceptNode[]; edges: ConceptEdge[] };
}

export const KnowledgeGraph: React.FC<KnowledgeGraphProps> = ({ graphData }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const visNodes = new DataSet(
      graphData.nodes.map(n => ({
        id: n.id,
        label: n.name,
        title: n.description,
        shape: 'box',
        margin: 12,
        color: {
          background: '#1e1b4b',
          border: '#818cf8',
          highlight: {
            background: '#4338ca',
            border: '#c7d2fe'
          }
        },
        font: {
          color: '#f8fafc',
          face: 'Plus Jakarta Sans',
          size: 13,
          bold: { color: '#ffffff' }
        }
      }))
    );

    const visEdges = new DataSet(
      graphData.edges.map(e => ({
        from: e.source_id,
        to: e.target_id,
        label: e.connection_type,
        arrows: 'to',
        color: { color: '#6366f1', opacity: 0.6 },
        font: { color: '#94a3b8', size: 10, align: 'middle' }
      }))
    );

    const options = {
      physics: {
        barnesHut: {
          gravitationalConstant: -3000,
          springLength: 120,
          springConstant: 0.04
        }
      },
      interaction: {
        hover: true,
        zoomView: true,
        dragView: true
      }
    };

    const network = new Network(containerRef.current, { nodes: visNodes, edges: visEdges }, options);

    return () => {
      network.destroy();
    };
  }, [graphData]);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Share2 size={24} className="text-purple-400" /> Grafo de Conocimiento Interactivo
          </h1>
          <p className="text-xs text-slate-400">
            Visualización topológica 2D impulsada por Vis.js de las conexiones entre conceptos, recursos y notas.
          </p>
        </div>
      </div>

      <div className="relative w-full h-[600px] rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-2xl">
        <div ref={containerRef} className="w-full h-full" />
        <div className="absolute bottom-4 left-4 p-3 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-800 text-[11px] text-slate-300 flex items-center gap-2">
          <Info size={14} className="text-purple-400" />
          <span>Arrastra y haz zoom para explorar relaciones semánticas entre nodos.</span>
        </div>
      </div>
    </div>
  );
};
