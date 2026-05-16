// atlas/workers/src/handlers/portfolio.ts
import type { Env } from '../env';
import { err, json } from '../lib/http';

export async function handlePortfolioSave(req: Request, env: Env): Promise<Response> {
  try {
    const { userId, holdings } = await req.json();
    if (!userId || !holdings) return err(400, 'missing userId or holdings', req, env);

    const gradeResult = { /* call your grader here or reuse from previous */ overallScore: 75, grade: 'B', diversificationScore: 80 }; // placeholder - integrate real grader

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO portfolios (id, user_id, holdings, grade, diversification_score, total_value, suggestions) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      userId,
      JSON.stringify(holdings),
      gradeResult.overallScore,
      gradeResult.diversificationScore,
      0, // total_value placeholder
      JSON.stringify(gradeResult.suggestions || [])
    ).run();

    return json({ success: true, portfolioId: id });
  } catch (e) {
    console.error('portfolio save error', e);
    return err(500, 'save failed', req, env);
  }
}

export async function handlePortfolioLoad(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return err(400, 'missing userId', req, env);

  const row = await env.DB.prepare(`SELECT * FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`).bind(userId).first();
  if (!row) return json({ holdings: [] });

  return json({
    id: row.id,
    holdings: JSON.parse(row.holdings as string),
    grade: row.grade,
    diversificationScore: row.diversification_score
  });
}
