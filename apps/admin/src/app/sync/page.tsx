'use client';

/**
 * Tela de sincronização.
 *
 * Mostra o que está acontecendo entre o Neon (principal, ADR 008) e o
 * Postgres local do docker: porcentagem, o que está sendo aplicado agora
 * e o que ainda está na fila, por entidade e por sentido.
 *
 * ── Duas decisões que valem explicação ──────────────────────────────
 *
 * 1. **A tela vive de `/sync/progress`, não de `/sync/status`.** O
 *    `status` lê o último `SyncRun`, que só existe depois que a execução
 *    terminou — serve para "como foi", não para "como está indo". O
 *    `progress` responde durante, e responde também parado: a lista de
 *    pendentes é a resposta para "o que ainda vai ser baixado" antes de
 *    qualquer execução começar.
 *
 * 2. **O intervalo muda com o estado.** Um segundo enquanto roda, para a
 *    barra andar; cinco segundos parado, porque nada muda sozinho e
 *    sondar de segundo em segundo um sistema ocioso só gasta conexão do
 *    Neon — que no plano gratuito é contada.
 *
 * O token fica em `localStorage`: o painel ainda não tem fluxo de login
 * (o scaffold está em `page.tsx`), e a rota exige SYNC_READ. Quando o
 * login existir, é só trocar `lerToken` pela sessão.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncProgressResponse } from '@atlas/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api';
const CHAVE_TOKEN = 'atlas.admin.token';

const INTERVALO_RODANDO_MS = 1_000;
const INTERVALO_PARADO_MS = 5_000;

function lerToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(CHAVE_TOKEN) ?? '';
}

const ROTULO_FASE: Record<string, string> = {
  IDLE: 'parada',
  PUSH: 'enviando ao Neon',
  PULL: 'baixando para o local',
};

export default function SyncPage() {
  const [token, setToken] = useState('');
  const [progresso, setProgresso] = useState<SyncProgressResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [disparando, setDisparando] = useState(false);

  // Guarda o token fora do estado do React também: o setInterval abaixo
  // captura o valor do render em que foi criado, e sem isto ele
  // continuaria mandando o token antigo depois de uma troca.
  const tokenRef = useRef('');

  useEffect(() => {
    const salvo = lerToken();
    setToken(salvo);
    tokenRef.current = salvo;
  }, []);

  const buscar = useCallback(async (): Promise<SyncProgressResponse | null> => {
    if (!tokenRef.current) return null;

    const resposta = await fetch(`${API_URL}/sync/progress`, {
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });

    if (resposta.status === 401 || resposta.status === 403) {
      throw new Error('Token inválido ou sem a permissão SYNC_READ.');
    }
    if (!resposta.ok) {
      throw new Error(`A API respondeu ${resposta.status}.`);
    }

    const corpo = (await resposta.json()) as { data: SyncProgressResponse };
    return corpo.data;
  }, []);

  useEffect(() => {
    if (!token) return;

    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // setTimeout encadeado em vez de setInterval: garante que uma sondagem
    // só comece depois que a anterior terminou. Com setInterval, uma
    // resposta lenta empilharia requisições em cima de si mesma.
    const ciclo = async (): Promise<void> => {
      try {
        const dados = await buscar();
        if (!vivo) return;

        if (dados) {
          setProgresso(dados);
          setErro(null);
        }

        timer = setTimeout(
          () => void ciclo(),
          dados?.running ? INTERVALO_RODANDO_MS : INTERVALO_PARADO_MS,
        );
      } catch (e) {
        if (!vivo) return;
        setErro(e instanceof Error ? e.message : String(e));
        // Segue tentando no ritmo lento: a API pode estar reiniciando.
        timer = setTimeout(() => void ciclo(), INTERVALO_PARADO_MS);
      }
    };

    void ciclo();

    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
    };
  }, [token, buscar]);

  const salvarToken = (valor: string): void => {
    window.localStorage.setItem(CHAVE_TOKEN, valor);
    tokenRef.current = valor;
    setToken(valor);
  };

  const dispararAgora = async (): Promise<void> => {
    setDisparando(true);
    setErro(null);

    try {
      const resposta = await fetch(`${API_URL}/sync/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ direction: 'BIDIRECTIONAL' }),
      });

      if (!resposta.ok) {
        throw new Error(`A API recusou o disparo (${resposta.status}).`);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setDisparando(false);
    }
  };

  if (!token) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Sincronização</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Cole um token de acesso com a permissão SYNC_READ para acompanhar.
        </p>

        <form
          className="card mt-6 flex gap-2"
          onSubmit={(evento) => {
            evento.preventDefault();
            const campo = new FormData(evento.currentTarget).get('token');
            if (typeof campo === 'string' && campo.trim()) salvarToken(campo.trim());
          }}
        >
          <input
            name="token"
            type="password"
            placeholder="access token"
            className="flex-1 rounded-lg border border-border bg-transparent px-3 py-2 font-mono text-sm"
          />
          <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium">
            Acompanhar
          </button>
        </form>
      </main>
    );
  }

  const totalPendente =
    progresso?.pending.reduce((soma, linha) => soma + linha.toCloud + linha.toLocal, 0) ?? 0;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sincronização</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {progresso?.running
              ? `Em andamento — ${ROTULO_FASE[progresso.phase] ?? progresso.phase}`
              : 'Parada'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void dispararAgora()}
          disabled={disparando || progresso?.running}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {progresso?.running ? 'Rodando…' : 'Sincronizar agora'}
        </button>
      </header>

      {erro && (
        <p className="card mb-6 border-l-4 border-l-red-500 text-sm" role="alert">
          {erro}
        </p>
      )}

      {progresso?.unavailable.length ? (
        <p className="card mb-6 border-l-4 border-l-amber-500 text-sm">
          Sem resposta de: {progresso.unavailable.join(', ')}. Os números abaixo cobrem só o lado
          que respondeu — é o normal logo depois de ligar o docker.
        </p>
      ) : null}

      <section className="card mb-6">
        <h2 className="card-title mb-4">Progresso</h2>

        <div
          className="h-2 w-full overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-valuenow={progresso?.percent ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${progresso?.percent ?? 0}%` }}
          />
        </div>

        <p className="mt-3 text-sm">
          <span className="text-2xl font-semibold tabular-nums">{progresso?.percent ?? 0}%</span>
          <span className="ml-2 text-ink-muted">
            {progresso?.total
              ? `${progresso.processed} de ${progresso.total} alterações`
              : 'nada a aplicar'}
          </span>
        </p>

        {progresso?.currentEntity && (
          <p className="mt-2 text-xs text-ink-faint">
            Aplicando agora: <span className="font-mono">{progresso.currentEntity}</span>
          </p>
        )}

        <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-border pt-4 text-sm">
          <div>
            <dt className="text-xs text-ink-faint">Aplicadas</dt>
            <dd className="tabular-nums">{progresso?.applied ?? 0}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Conflitos</dt>
            <dd className="tabular-nums">{progresso?.conflicts ?? 0}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">Falhas</dt>
            <dd className="tabular-nums">{progresso?.failed ?? 0}</dd>
          </div>
        </dl>
      </section>

      <section className="card">
        <h2 className="card-title mb-1">Na fila</h2>
        <p className="mb-4 text-xs text-ink-faint">
          {totalPendente === 0
            ? 'Nada pendente — os dois bancos estão em dia.'
            : `${totalPendente} alteração(ões) esperando.`}
        </p>

        {totalPendente > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-ink-faint">
                <th className="pb-2 font-normal">Entidade</th>
                <th className="pb-2 text-right font-normal">Vai subir</th>
                <th className="pb-2 text-right font-normal">Vai descer</th>
              </tr>
            </thead>
            <tbody>
              {progresso?.pending.map((linha) => (
                <tr key={linha.entity} className="border-b border-border last:border-0">
                  <td className="py-2 font-mono text-xs">{linha.entity}</td>
                  <td className="py-2 text-right tabular-nums">{linha.toCloud || '—'}</td>
                  <td className="py-2 text-right tabular-nums">{linha.toLocal || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="mt-6 text-xs leading-relaxed text-ink-faint">
        &ldquo;Vai subir&rdquo; é o que nasceu no Postgres local e ainda não chegou ao Neon;
        &ldquo;vai descer&rdquo; é o contrário. Com o docker desligado, só a primeira coluna se
        movimenta.
      </p>
    </main>
  );
}
