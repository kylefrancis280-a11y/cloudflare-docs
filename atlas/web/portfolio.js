// atlas/workers/src/handlers/portfolio.ts
import type { Env } from '../env';
import { err, json } from '../lib/http';

/**
 * Save user portfolio + calculate Atlas Score
 * (Future: replace hardcoded grading with Grok API call)
 */
export async function handlePortfolioSave(req: Request, env: Env): Promise<Response> {
  try {
    const { userId, holdings } = await req.json();

    if (!userId || typeof userId !== 'string') {
      return err(400, 'missing or invalid userId', req, env);
    }
    if (!holdings || !Array.isArray(holdings)) {
      return err(400, 'holdings must be a valid JSON array', req, env);
    }

    // TODO: In the future replace this with real Grok-powered grading
    const gradeResult = {
      atlasScore: 85,
      diversificationScore: 92,
      stabilityScore: 78,        // focused on ETF / low-vol stability
      grade: 'A-',
      suggestions: holdings.length < 8
        ? ['Consider adding 2-3 core Value ETFs (e.g. VTV, VOO) for better stability']
        : ['Portfolio shows good diversification and ETF exposure']
    };

    const id = crypto.randomUUID();

    await env.DB.prepare(`
      INSERT INTO portfolios (
        id, user_id, holdings,
        atlas_score, diversification_score, stability_score,
        grade, suggestions, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      id,
      userId,
      JSON.stringify(holdings),
      gradeResult.atlasScore,
      gradeResult.diversificationScore,
      gradeResult.stabilityScore,
      gradeResult.grade,
      JSON.stringify(gradeResult.suggestions)
    ).run();

    return json({
      success: true,
      portfolioId: id,
      scores: {
        atlas: gradeResult.atlasScore,
        diversification: gradeResult.diversificationScore,
        stability: gradeResult.stabilityScore
      },
      grade: gradeResult.grade
    });

  } catch (e) {
    console.error('portfolio save error', e);
    return err(500, 'failed to save portfolio', req, env);
  }
}

/**
 * Load latest saved portfolio for a user
 */
export async function handlePortfolioLoad(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId');

    if (!userId) return err(400, 'missing userId', req, env);

    const row = await env.DB.prepare(
      `SELECT * FROM portfolios WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`
    ).bind(userId).first();

    if (!row) {
      return json({ holdings: [], scores: { atlas: 0, diversification: 0, stability: 0 }, grade: '—' });
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
    return err(500, 'failed to load portfolio', req, env);
  }
}
