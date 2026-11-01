/**
 * SQL for "count of rows per week for the last N weeks, zero-filled". Weeks start on Monday (UTC). `fromSql`, `tsColumn`
 * and `whereSql` are fixed strings written in code (never user input); callers pass user-derived values only as $n params.
 * The first `params.length` placeholders are the caller's; the result has columns (week 'YYYY-MM-DD', n integer).
 */
function weeklyCountsSql({ fromSql, tsColumn, whereSql = 'TRUE', weeks = 8 }) {
  const w = Number(weeks)
  if (!Number.isInteger(w) || w < 1 || w > 52) throw new Error('weeks must be 1-52')
  return `SELECT to_char(g.week, 'YYYY-MM-DD') AS week, COALESCE(c.n, 0)::int AS n
            FROM generate_series(date_trunc('week', now() AT TIME ZONE 'UTC') - interval '${w - 1} weeks', date_trunc('week', now() AT TIME ZONE 'UTC'), interval '1 week') AS g(week)
            LEFT JOIN (
              SELECT date_trunc('week', ${tsColumn} AT TIME ZONE 'UTC') AS week, count(*) AS n
                FROM ${fromSql}
               WHERE ${whereSql} AND ${tsColumn} >= date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '${w - 1} weeks'
               GROUP BY 1
            ) c ON c.week = g.week
           ORDER BY g.week`
}
module.exports = { weeklyCountsSql }
