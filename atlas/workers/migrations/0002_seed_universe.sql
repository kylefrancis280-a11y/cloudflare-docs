-- 0002_seed_universe.sql
-- Populates the stock universe (single source of truth)
-- Idempotent: safe to re-run at any time (updates names, industries, etc.)

INSERT INTO universe (ticker, name, exchange, industry, sector, pe, market_cap, active)
VALUES
-- ── Mining ─────────────────────────────────────────────────────
('ABX','Barrick Gold Corp','NYSE','Gold Mining','mining',16.4,33000,1),
('NEM','Newmont Corporation','NYSE','Gold Mining','mining',18.1,42000,1),
('AEM','Agnico Eagle Mines','NYSE','Gold Mining','mining',19.7,36000,1),
('WPM','Wheaton Precious Metals','NYSE','Precious Metals Streaming','mining',29.2,25000,1),
('TECK','Teck Resources Ltd','NYSE','Diversified Mining','mining',9.8,18000,1),
('FCX','Freeport-McMoRan Inc','NYSE','Copper & Gold Mining','mining',22.0,60000,1),
('RIO','Rio Tinto Group','NYSE','Diversified Mining','mining',9.4,108000,1),
('BHP','BHP Group Ltd','NYSE','Diversified Mining','mining',11.3,145000,1),
('VALE','Vale S.A.','NYSE','Iron Ore & Nickel','mining',6.1,52000,1),
('KGC','Kinross Gold Corp','NYSE','Gold Mining','mining',14.2,11000,1),
('PAAS','Pan American Silver','NYSE','Silver Mining','mining',31.0,7000,1),
('AG','First Majestic Silver','NYSE','Silver Mining','mining',0,2000,1),
('FNV','Franco-Nevada Corp','NYSE','Royalty & Streaming','mining',41.0,27000,1),
('SLI','Standard Lithium','NYSE','Lithium Mining','mining',0,400,1),
('LAC','Lithium Americas','NYSE','Lithium Mining','mining',0,800,1),
('ALB','Albemarle Corp','NYSE','Lithium','mining',0,11000,1),
('MP','MP Materials Corp','NYSE','Rare Earth','mining',0,2500,1),
('SCCO','Southern Copper Corp','NYSE','Copper Mining','mining',21.5,80000,1),
('AA','Alcoa Corporation','NYSE','Aluminum','mining',0,6500,1),

-- ── AI ─────────────────────────────────────────────────────────
('PLTR','Palantir Technologies','NYSE','Defense & Enterprise AI','ai',130,170000,1),
('AI','C3.ai Inc','NYSE','Enterprise AI','ai',0,3500,1),
('PATH','UiPath Inc','NYSE','RPA + AI','ai',0,7500,1),
('SOUN','SoundHound AI Inc','NYSE','Conversational AI','ai',0,4000,1),
('BBAI','BigBear.ai Holdings','NYSE','Decision Intelligence','ai',0,1100,1),
('SNOW','Snowflake Inc','NYSE','Data + AI Platform','ai',0,60000,1),
('CRWD','CrowdStrike Holdings','NYSE','AI Cybersecurity','ai',82.0,110000,1),
('DDOG','Datadog Inc','NYSE','AI Observability','ai',78.0,42000,1),
('NVDA','NVIDIA Corporation','NYSE','AI Chips','ai',45.0,3500000,1),
('AMD','Advanced Micro Devices','NYSE','AI Semiconductors','ai',48.0,230000,1),
('MSFT','Microsoft Corporation','NYSE','Cloud + AI','ai',35.0,3200000,1),
('GOOGL','Alphabet Inc','NYSE','Search + AI','ai',24.0,2100000,1),
('META','Meta Platforms Inc','NYSE','Social + AI','ai',26.0,1500000,1),
('AMZN','Amazon.com Inc','NYSE','Cloud + AI','ai',45.0,2000000,1),

-- ── Tech ───────────────────────────────────────────────────────
('SHOP','Shopify Inc','NYSE','E-Commerce Platform','tech',65.0,110000,1),
('ANET','Arista Networks','NYSE','AI Cloud Networking','tech',35.0,110000,1),
('TSM','Taiwan Semiconductor','NYSE','Semiconductor Foundry','tech',24.0,700000,1),
('OTEX','Open Text Corp','NYSE','Enterprise Software','tech',11.0,7500,1),
('GDDY','GoDaddy Inc','NYSE','Web Services','tech',24.0,22000,1),
('CSU','Constellation Software','TSX','Vertical Market Software','tech',72.0,65000,1),
('CRM','Salesforce Inc','NYSE','Enterprise CRM','tech',45.0,290000,1),
('ORCL','Oracle Corporation','NYSE','Cloud + Database','tech',32.0,380000,1),
('PANW','Palo Alto Networks','NYSE','Cybersecurity','tech',90.0,110000,1),
('NOW','ServiceNow Inc','NYSE','IT Workflow','tech',105,175000,1),
('AVGO','Broadcom Inc','NYSE','Semiconductors','tech',35.0,1000000,1),

-- ── Biotech ────────────────────────────────────────────────────
('MRNA','Moderna Inc','NYSE','mRNA Therapeutics','biotech',0,14000,1),
('CRSP','CRISPR Therapeutics','NYSE','Gene Editing','biotech',0,4000,1),
('BNTX','BioNTech SE','NYSE','mRNA Immunotherapy','biotech',0,25000,1),
('ABCL','AbCellera Biologics','NYSE','AI Antibody Discovery','biotech',0,700,1),
('VRTX','Vertex Pharmaceuticals','NYSE','Rare Disease','biotech',24.0,110000,1),
('RXRX','Recursion Pharmaceuticals','NYSE','AI Drug Discovery','biotech',0,1700,1),

-- ── Energy ─────────────────────────────────────────────────────
('SU','Suncor Energy','NYSE','Oil Sands','energy',9.0,55000,1),
('CNQ','Canadian Natural Resources','NYSE','Oil & Gas','energy',10.0,80000,1),
('ENB','Enbridge Inc','NYSE','Pipeline & Midstream','energy',19.0,100000,1),
('CCJ','Cameco Corporation','NYSE','Uranium Mining','energy',85.0,22000,1),
('XOM','Exxon Mobil Corporation','NYSE','Integrated Oil & Gas','energy',13.0,480000,1),
('CVX','Chevron Corporation','NYSE','Integrated Oil & Gas','energy',14.0,290000,1),
('FSLR','First Solar Inc','NYSE','Solar Manufacturing','energy',18.0,22000,1),
('NEE','NextEra Energy Inc','NYSE','Renewables & Utility','energy',19.0,145000,1),

-- ── Defense ────────────────────────────────────────────────────
('LMT','Lockheed Martin Corp','NYSE','Aerospace & Defense','defense',16.0,110000,1),
('GD','General Dynamics','NYSE','Defense & Aerospace','defense',20.0,75000,1),
('RTX','RTX Corporation','NYSE','Defense & Aerospace','defense',22.0,160000,1),
('NOC','Northrop Grumman Corp','NYSE','Aerospace & Defense','defense',19.0,75000,1),
('AXON','Axon Enterprise Inc','NYSE','Law Enforcement Tech','defense',95.0,40000,1),

-- ── Media ──────────────────────────────────────────────────────
('DIS','Walt Disney Company','NYSE','Entertainment & Streaming','media',22.0,180000,1),
('NFLX','Netflix Inc','NYSE','Streaming','media',38.0,310000,1),
('SPOT','Spotify Technology','NYSE','Audio Streaming','media',75.0,90000,1),
('WBD','Warner Bros Discovery','NYSE','Media & Entertainment','media',0,22000,1),
('ROKU','Roku Inc','NYSE','Connected TV Platform','media',0,8000,1),

-- ── Other ──────────────────────────────────────────────────────
('V','Visa Inc','NYSE','Payment Networks','other',32.0,560000,1),
('MA','Mastercard Inc','NYSE','Payment Networks','other',38.0,440000,1),
('SQ','Block Inc','NYSE','Fintech','other',24.0,40000,1),
('COST','Costco Wholesale','NYSE','Retail','other',55.0,400000,1),
('BRK.B','Berkshire Hathaway','NYSE','Diversified Holdings','other',12.0,900000,1),
('JPM','JPMorgan Chase','NYSE','Investment Banking','other',13.0,640000,1),
('GS','Goldman Sachs','NYSE','Investment Banking','other',16.0,170000,1),
('WMT','Walmart Inc','NYSE','Retail','other',32.0,550000,1)

ON CONFLICT(ticker) DO UPDATE SET
  name       = excluded.name,
  exchange   = excluded.exchange,
  industry   = excluded.industry,
  sector     = excluded.sector,
  pe         = COALESCE(excluded.pe, universe.pe),
  market_cap = COALESCE(excluded.market_cap, universe.market_cap),
  active     = excluded.active,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
