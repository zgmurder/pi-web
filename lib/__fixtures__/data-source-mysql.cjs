const state = { queries: [], destroyed: 0, rows: [{ total: '42' }], fail: false, options: null };
module.exports = {
  state,
  createConnection(options) {
    state.options = options;
    return {
      promise() { return {
        async query(sql) { state.queries.push(sql); if (state.fail) throw new Error('secret password and SQL'); return [[], []]; },
        destroy() { state.destroyed++; },
      }; },
      query(options, params) {
        state.queries.push({ ...options, params });
        return { stream() { return (async function* () { for (const row of state.rows) yield row; })(); } };
      },
    };
  },
};
