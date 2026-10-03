// squadrules-compat-surface: reads or aliases KAIROS_* environment variable names still honored for existing deployments
import crypto from 'node:crypto';
import type { Memory, InferenceContractDefinition } from '../../types/memory.js';
import { KAIROS_APP_SPACE_ID } from '../../config.js';

type QdrantPointLike = {
  id?: string | number | null;
  payload?: Record<string, unknown> | null;
};

export function pointToMemory(point: QdrantPointLike): Memory {
  const payload = (point.payload ?? {}) as any;
  const memoryUuid = point.id ? String(point.id) : crypto.randomUUID();
  const base: any = {
    memory_uuid: memoryUuid,
    ...(typeof payload.space_id === 'string' &&
      payload.space_id.length > 0 && { space_id: payload.space_id }),
    label:
      typeof payload.label === 'string' && payload.label.length > 0
        ? payload.label
        : 'Memory',
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    text: typeof payload.text === 'string' ? payload.text : '',
    llm_model_id:
      typeof payload.llm_model_id === 'string'
        ? payload.llm_model_id
        : 'unknown-model',
    created_at:
      typeof payload.created_at === 'string'
        ? payload.created_at
        : new Date().toISOString(),
    ...(typeof payload.content_type === 'string' &&
      payload.content_type.length > 0 && { content_type: payload.content_type }),
    ...(typeof payload.slug === 'string' &&
      payload.slug.trim().length > 0 && { slug: payload.slug.trim() }),
  };

  const payloadAdapter: any =
    payload.adapter && typeof (payload.adapter as { id?: unknown }).id === 'string'
      ? payload.adapter
      : null;

  if (payloadAdapter) {
    base.adapter = {
      id: payloadAdapter.id,
      name:
        typeof payloadAdapter.name === 'string'
          ? payloadAdapter.name
          : 'Knowledge Adapter',
      layer_index:
        typeof payloadAdapter.layer_index === 'number'
          ? payloadAdapter.layer_index
          : 1,
      layer_count:
        typeof payloadAdapter.layer_count === 'number'
          ? payloadAdapter.layer_count
          : 1,
      ...(typeof payloadAdapter.protocol_version === 'string' && {
        protocol_version: payloadAdapter.protocol_version,
      }),
      ...(Array.isArray(payloadAdapter.activation_patterns) && {
        activation_patterns: payloadAdapter.activation_patterns,
      }),
      ...(typeof payloadAdapter.reward_signal === 'string' && {
        reward_signal: payloadAdapter.reward_signal,
      }),
    };
  }

  const payloadContract: any =
    payload.inference_contract &&
    typeof payload.inference_contract === 'object'
      ? payload.inference_contract
      : null;

  if (payloadContract) {
    if (typeof payloadContract.cmd === 'string') {
      base.inference_contract = {
        cmd: payloadContract.cmd,
        timeout_seconds:
          typeof payloadContract.timeout_seconds === 'number'
            ? payloadContract.timeout_seconds
            : 60,
        required: Boolean(payloadContract.required),
      };
    } else {
      base.inference_contract =
        payloadContract as unknown as InferenceContractDefinition;
    }
  }

  const pointSpaceId =
    typeof payload.space_id === 'string' && payload.space_id.length > 0
      ? payload.space_id
      : KAIROS_APP_SPACE_ID;
  if (!('space_id' in base) && pointSpaceId) {
    base.space_id = pointSpaceId;
  }

  return base as unknown as Memory;
}
