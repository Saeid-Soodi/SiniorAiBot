const states = new Map();

function setState(userId, type, data = {}) {
  states.set(Number(userId), { type, data, startedAt: Date.now() });
}
function getState(userId) { return states.get(Number(userId)) || null; }
function clearState(userId) { states.delete(Number(userId)); }
function hasState(userId, type = null) {
  const state = getState(userId);
  return !!state && (!type || state.type === type);
}

module.exports = { setState, getState, clearState, hasState };
