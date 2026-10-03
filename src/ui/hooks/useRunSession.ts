import { useCallback, useEffect, useMemo, useState } from "react";
import type { RunContract, RunLayer, RunSolutionSubmission } from "@/lib/runToolTypes";

export type RunHistoryItem = {
  layer: RunLayer;
  contract: RunContract;
  solution: RunSolutionSubmission;
  submitted_at: string;
  /** proof_hash returned by server after submission (used as previous proof for next step) */
  proof_hash?: string;
  server_message?: string;
};

export type RunSession = {
  id: string;
  adapter_uri: string;
  started_at: string;
  updated_at: string;
  status: "running" | "ready_to_reward" | "completed" | "error";
  /** May be null when response has no current_layer (schema allows optional/nullable). */
  current_layer: RunLayer | null;
  contract: RunContract;
  next_action?: string;
  last_message?: string;
  previous_proof_hash?: string;
  reward_uri?: string;
  history: RunHistoryItem[];
};

const STORAGE_KEY = "squadrules.runSessions.v1";

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeRunSession(raw: unknown): RunSession | null {
  if (!raw || typeof raw !== "object") return null;
  const session = raw as Record<string, unknown>;
  const adapterUri =
    typeof session.adapter_uri === "string"
      ? session.adapter_uri
      : typeof session.protocol_uri === "string"
        ? session.protocol_uri
        : null;
  const currentLayer =
    session.current_layer && typeof session.current_layer === "object"
      ? (session.current_layer as RunLayer)
      : session.current_step && typeof session.current_step === "object"
        ? (session.current_step as RunLayer)
        : null;
  const contract =
    session.contract && typeof session.contract === "object"
      ? (session.contract as RunContract)
      : session.challenge && typeof session.challenge === "object"
        ? (session.challenge as RunContract)
        : null;
  const history = Array.isArray(session.history)
    ? session.history
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as Record<string, unknown>;
          const layer =
            item.layer && typeof item.layer === "object"
              ? (item.layer as RunLayer)
              : item.step && typeof item.step === "object"
                ? (item.step as RunLayer)
                : null;
          const itemContract =
            item.contract && typeof item.contract === "object"
              ? (item.contract as RunContract)
              : item.challenge && typeof item.challenge === "object"
                ? (item.challenge as RunContract)
                : null;
          const solution =
            item.solution && typeof item.solution === "object"
              ? (item.solution as RunSolutionSubmission)
              : null;
          const submittedAt = typeof item.submitted_at === "string" ? item.submitted_at : null;
          if (!layer || !itemContract || !solution || !submittedAt) {
            return null;
          }
          return {
            layer,
            contract: itemContract,
            solution,
            submitted_at: submittedAt,
            ...(typeof item.proof_hash === "string" ? { proof_hash: item.proof_hash } : {}),
            ...(typeof item.server_message === "string" ? { server_message: item.server_message } : {}),
          };
        })
        .filter((entry): entry is RunHistoryItem => entry !== null)
    : [];
  const status =
    session.status === "ready_to_attest"
      ? "ready_to_reward"
      : session.status === "running" ||
          session.status === "ready_to_reward" ||
          session.status === "completed" ||
          session.status === "error"
        ? session.status
        : null;
  if (
    !adapterUri ||
    typeof session.id !== "string" ||
    typeof session.started_at !== "string" ||
    typeof session.updated_at !== "string" ||
    !status ||
    !contract
  ) {
    return null;
  }
  return {
    id: session.id,
    adapter_uri: adapterUri,
    started_at: session.started_at,
    updated_at: session.updated_at,
    status,
    current_layer: currentLayer,
    contract,
    ...(typeof session.next_action === "string" ? { next_action: session.next_action } : {}),
    ...(typeof session.last_message === "string" ? { last_message: session.last_message } : {}),
    ...(typeof session.previous_proof_hash === "string"
      ? { previous_proof_hash: session.previous_proof_hash }
      : {}),
    ...(typeof session.reward_uri === "string"
      ? { reward_uri: session.reward_uri }
      : typeof session.attest_uri === "string"
        ? { reward_uri: session.attest_uri }
        : {}),
    history,
  };
}

function loadAll(): RunSession[] {
  const parsed = safeJsonParse<unknown[]>(typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null);
  return Array.isArray(parsed)
    ? parsed
        .map((entry) => normalizeRunSession(entry))
        .filter((entry): entry is RunSession => entry !== null)
    : [];
}

function saveAll(all: RunSession[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function useRunSessions() {
  const [sessions, setSessions] = useState<RunSession[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSessions(loadAll());
  }, []);

  const refresh = useCallback(() => {
    setSessions(loadAll());
  }, []);

  const upsert = useCallback((session: RunSession) => {
    const all = loadAll();
    const idx = all.findIndex((s) => s.id === session.id);
    const next = idx >= 0 ? [...all.slice(0, idx), session, ...all.slice(idx + 1)] : [session, ...all];
    saveAll(next);
    setSessions(next);
  }, []);

  const remove = useCallback((id: string) => {
    const all = loadAll();
    const next = all.filter((s) => s.id !== id);
    saveAll(next);
    setSessions(next);
  }, []);

  return { sessions, refresh, upsert, remove };
}

export function useRunSession(sessionId: string | null) {
  const { sessions, upsert } = useRunSessions();
  const session = useMemo(() => sessions.find((s) => s.id === sessionId) ?? null, [sessions, sessionId]);
  const update = useCallback(
    (next: RunSession) => {
      upsert(next);
    },
    [upsert]
  );
  return { session, update };
}

