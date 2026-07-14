const states = new Map();
const DEFAULT_TTL_MS = 60 * 60 * 1000;

function normalizeUserId(userId) {
  const id = Number(userId);
  if (!Number.isFinite(id)) throw new TypeError('Invalid user id for state manager');
  return id;
}

function setState(userId, type, data = {}) {
  const id = normalizeUserId(userId);
  const now = Date.now();
  const state = { type, data, startedAt: now, updatedAt: now };
  states.set(id, state);
  return state;
}

function getState(userId) {
  const id = normalizeUserId(userId);
  const state = states.get(id) || null;
  if (!state) return null;
  if (Date.now() - state.updatedAt > DEFAULT_TTL_MS) {
    states.delete(id);
    return null;
  }
  return state;
}

function updateState(userId, updater) {
  const id = normalizeUserId(userId);
  const state = getState(id);
  if (!state) return null;
  const next = typeof updater === 'function' ? updater(state) || state : { ...state, ...updater };
  next.updatedAt = Date.now();
  states.set(id, next);
  return next;
}

function clearState(userId) {
  states.delete(normalizeUserId(userId));
}

function hasState(userId, type = null) {
  const state = getState(userId);
  return Boolean(state && (!type || state.type === type));
}

module.exports = { setState, getState, updateState, clearState, hasState };
