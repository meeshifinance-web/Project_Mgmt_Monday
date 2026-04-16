import { useState, useCallback } from 'react';
import {
  getCascadeTemplates, saveCascadeTemplates, updateCascadeStep, deleteCascadeTemplates,
  getCascadeRules, createCascadeRule, updateCascadeRule, deleteCascadeRule,
  triggerDateCascade, getCascadeLogs, overrideCascadeMeta,
} from '../api';

/**
 * Hook wrapping all /api/date-cascade calls.
 * Provides loading + error state alongside each action.
 */
export function useAutomation(boardId) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const wrap = useCallback(async (fn) => {
    setError(null);
    setLoading(true);
    try {
      return await fn();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Request failed';
      setError(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTemplates = useCallback(() =>
    wrap(() => getCascadeTemplates(boardId)), [boardId, wrap]);

  const saveTemplates = useCallback((steps) =>
    wrap(() => saveCascadeTemplates(boardId, steps)), [boardId, wrap]);

  const updateStep = useCallback((stepId, data) =>
    wrap(() => updateCascadeStep(boardId, stepId, data)), [boardId, wrap]);

  const deleteTemplates = useCallback(() =>
    wrap(() => deleteCascadeTemplates(boardId)), [boardId, wrap]);

  const fetchRules = useCallback(() =>
    wrap(() => getCascadeRules(boardId)), [boardId, wrap]);

  const createRule = useCallback((data) =>
    wrap(() => createCascadeRule(boardId, data)), [boardId, wrap]);

  const updateRule = useCallback((ruleId, data) =>
    wrap(() => updateCascadeRule(ruleId, data)), [wrap]);

  const deleteRule = useCallback((ruleId) =>
    wrap(() => deleteCascadeRule(ruleId)), [wrap]);

  const trigger = useCallback((data) =>
    wrap(() => triggerDateCascade(data)), [wrap]);

  const fetchLogs = useCallback((itemId) =>
    wrap(() => getCascadeLogs(boardId, itemId)), [boardId, wrap]);

  const overrideMeta = useCallback((item_id, column_id) =>
    wrap(() => overrideCascadeMeta(item_id, column_id)), [wrap]);

  return {
    loading, error,
    fetchTemplates, saveTemplates, updateStep, deleteTemplates,
    fetchRules, createRule, updateRule, deleteRule,
    trigger, fetchLogs, overrideMeta,
  };
}
