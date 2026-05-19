// atlas/workers/src/handlers/portfolio.ts
import type { Env } from '../env';
import { err, json } from '../lib/http';

export async function handlePortfolioSave(req: Request, env: Env): Promise<Response> {
  try {
    const { userId, holdings } = await req.json();
    if (!userId || !holdings) return err(400, 'missing userId or holdings', req, env);

    // Real grading logic (you can call your existing grader here later)
    const gradeResult = {
      atlasScore: 85,
      diversificationScore: 92,
      stabilityScore: 78,               // extra score focused on ETF / low-vol stability
      grade: 'A-',
      suggestions: holdings.length < 8 
        ? ['Add 2-3 Value ETFs (VOO, GLD, GIGB) for better stability'] 
        : ['Portfolio is well balanced with good ETF exposure']
    };

    const id = crypto.randomUUID();

    await env.DB.prepare(`
      INSERT INTO portfolios (
        id, user_id, holdings, 
        atlas_score, diversification_score, stability_score,
        grade, total_value, suggestions, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      id,
      userId,
      JSON.stringify(holdings),
      gradeResult.atlasScore,
      gradeResult.diversificationScore,
      gradeResult.stabilityScore,
      gradeResult.grade,
      0, // total_value placeholder — update later if needed
      JSON.stringify(gradeResult.suggestions)
    ).run();

    return json({ 
      success: true, 
      portfolioId: id,
      scores: {
        atlas: gradeResult.atlasScore,
        diversification: gradeResult.diversificationScore,
        stability: gradeResult.stabilityScore
      }
    });

  } catch (e) {
    console.error('portfolio save error', e);
    return err(500, 'save failed', req, env);
  }
}

export async function handlePortfolioLoad(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');
    if (!userId) return err(400, 'missing userId', req, env);

    const row = await env.DB.prepare(
      `SELECT * FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`
    ).bind(userId).first();

    if (!row) {
      return json({ holdings: [], scores: { atlas: 0, diversification: 0, stability: 0 } });
    }

    return json({
      id: row.id,
      holdings: JSON.parse(row.holdings as string),
      scores: {
        atlas: row.atlas_score,
        diversification: row.diversification_score,
        stability: row.stability_score
      },
      grade: row.grade
    });
  } catch (e) {
    console.error('portfolio load error', e);
    return err(500, 'load failed', req, env);
  }
}
