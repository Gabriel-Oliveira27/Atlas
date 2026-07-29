'use client';

/**
 * Catálogo de exercícios — lê os dados criados pelo seed.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { QueryState } from '@/components/query-state';
import { IconChevronRight, IconSearch } from '@/components/icons';

interface Exercise {
  id: string;
  name: string;
  difficulty: string;
  mechanic: string | null;
  force: string | null;
  muscleGroup: { id: string; name: string };
  equipment: Array<{ equipment: { id: string; name: string } }>;
  stimulusHypertrophy: number;
  stimulusStrength: number;
}

interface MuscleGroup {
  id: string;
  name: string;
  children: Array<{ id: string; name: string }>;
}

const DIFFICULTY: Record<string, { label: string; className: string }> = {
  BEGINNER: { label: 'Iniciante', className: 'text-positive' },
  INTERMEDIATE: { label: 'Intermediário', className: 'text-warning' },
  ADVANCED: { label: 'Avançado', className: 'text-danger' },
};

export default function ExerciciosPage() {
  const [search, setSearch] = useState('');
  const [groupId, setGroupId] = useState<string>('');

  const groupsQuery = useQuery({
    queryKey: ['muscle-groups'],
    queryFn: () => api.get<MuscleGroup[]>('/exercises/muscle-groups'),
    staleTime: 5 * 60_000,
  });

  const query = useQuery({
    queryKey: ['exercises', search, groupId],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: '50' });
      if (search.trim()) params.set('search', search.trim());
      if (groupId) params.set('muscleGroupId', groupId);
      return api.get<Exercise[]>(`/exercises?${params.toString()}`);
    },
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl p-5 md:p-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Exercícios</h1>

        <div className="mb-5 space-y-3">
          <div className="relative">
            <IconSearch
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar exercício…"
              className="input pl-9"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setGroupId('')}
              className={groupId === '' ? 'chip-active' : 'chip'}
            >
              Todos
            </button>
            {groupsQuery.data?.map((group) => (
              <button
                key={group.id}
                onClick={() => setGroupId(group.id)}
                className={groupId === group.id ? 'chip-active' : 'chip'}
              >
                {group.name}
              </button>
            ))}
          </div>
        </div>

        <QueryState
          query={query}
          isEmpty={(data) => data.length === 0}
          emptyMessage="Nenhum exercício encontrado com esses filtros."
        >
          {(exercises) => (
            <>
              <p className="mb-3 text-xs text-ink-faint">{exercises.length} exercício(s)</p>
              <ul className="grid gap-3 sm:grid-cols-2">
                {exercises.map((exercise) => {
                  const difficulty = DIFFICULTY[exercise.difficulty];
                  return (
                    <li
                      key={exercise.id}
                      className="card relative transition hover:border-accent/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="text-sm font-medium leading-snug">
                          <Link
                            href={`/exercicios/${exercise.id}`}
                            className="after:absolute after:inset-0"
                          >
                            {exercise.name}
                          </Link>
                        </h2>
                        {difficulty && (
                          <span className={`shrink-0 text-[10px] ${difficulty.className}`}>
                            {difficulty.label}
                          </span>
                        )}
                      </div>

                      <p className="mt-1 text-xs text-ink-muted">
                        {exercise.muscleGroup.name}
                        {exercise.mechanic &&
                          ` · ${exercise.mechanic === 'COMPOUND' ? 'Composto' : 'Isolado'}`}
                      </p>

                      {exercise.equipment.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {exercise.equipment.map((item) => (
                            <span
                              key={item.equipment.id}
                              className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-ink-faint"
                            >
                              {item.equipment.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Estímulos: a informação que diferencia o catálogo */}
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex gap-4 text-[10px] text-ink-faint">
                          <span>
                            Hipertrofia{' '}
                            <span className="font-medium text-accent">
                              {exercise.stimulusHypertrophy}/5
                            </span>
                          </span>
                          <span>
                            Força{' '}
                            <span className="font-medium text-accent">
                              {exercise.stimulusStrength}/5
                            </span>
                          </span>
                        </div>
                        <IconChevronRight size={14} className="text-ink-faint" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </QueryState>
      </div>
    </AppShell>
  );
}
