function paginationRow(page, totalPages, prefix) {
  const row = [];
  if (page > 1) row.push({ text: '⬅️ قبلی', callback_data: `${prefix}_${page - 1}` });
  row.push({ text: `${page} / ${Math.max(totalPages, 1)}`, callback_data: 'noop' });
  if (page < totalPages) row.push({ text: 'بعدی ➡️', callback_data: `${prefix}_${page + 1}` });
  return row;
}
module.exports = { paginationRow };
