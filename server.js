require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory log (last 50 alerts)
const alertLog = [];

const SYSTEM_PROMPT = `You are a disciplined prop trading assistant for Divine, an active XAUUSD/XAGUSD/BTCUSD trader.

Your job is to validate incoming TradingView alerts against his A+ setup criteria and give a clear trade decision.

## A+ SETUP CRITERIA (ALL must align for a valid trade):
1. **BOS (Break of Structure)** – Price has broken a recent high/low in the direction of the trade
2. **Order Block Confluence** – Trade entry is at or near a valid order block
3. **Key Horizontal Level** – Entry aligns with a significant support/resistance level
4. **Multi-timeframe MA Alignment** – MAs on M15, M30, and H4 all align in the trade direction
5. **RSI Confirmation** – RSI supports the direction (not overbought on buys, not oversold on sells)

## SESSION RULE:
Valid trading hours: 8 AM – 3 PM WAT (Lagos time). Reject signals outside this window.

## LOT SIZE RULE (NON-NEGOTIABLE):
MAXIMUM LOT SIZE: 0.01 — Never recommend more. Always state this explicitly.

## VALID PAIRS:
XAUUSD, XAGUSD, BTCUSD, GBPJPY

## RESPONSE FORMAT:
Always respond in this exact JSON structure:
{
  "decision": "TAKE" or "SKIP",
  "confidence": "HIGH" / "MEDIUM" / "LOW",
  "criteria_check": {
    "bos": true/false,
    "order_block": true/false,
    "key_level": true/false,
    "ma_alignment": true/false,
    "rsi": true/false
  },
  "criteria_passed": 0-5,
  "lot_size": 0.01,
  "reasoning": "2-3 sentence explanation",
  "risk_note": "Any specific risk warning or 'None'"
}`;

async function analyzeWithClaude(alertData) {
  const userMessage = `New TradingView Alert:
Pair: ${alertData.pair || 'Unknown'}
Action: ${alertData.action || 'Unknown'}
Price: ${alertData.price || 'N/A'}
Timeframe: ${alertData.timeframe || 'M15'}
RSI: ${alertData.rsi || 'N/A'}
MA Trend: ${alertData.ma_trend || 'N/A'}
BOS Detected: ${alertData.bos || 'N/A'}
Order Block: ${alertData.order_block || 'N/A'}
Key Level: ${alertData.key_level || 'N/A'}
Session Time (WAT): ${alertData.time || new Date().toLocaleTimeString('en-US', { timeZone: 'Africa/Lagos' })}
Additional Notes: ${alertData.notes || 'None'}

Validate this against all 5 A+ criteria and return your JSON decision.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  const data = await response.json();
  const raw = data.content[0].text;

  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { decision: 'ERROR', reasoning: raw, lot_size: 0.01 };
  }
}

// POST /webhook — TradingView sends alerts here
app.post('/webhook', async (req, res) => {
  const alertData = req.body;
  console.log('Alert received:', alertData);

  const timestamp = new Date().toISOString();

  try {
    const analysis = await analyzeWithClaude(alertData);

    const logEntry = {
      id: Date.now(),
      timestamp,
      alert: alertData,
      analysis
    };

    alertLog.unshift(logEntry);
    if (alertLog.length > 50) alertLog.pop();

    console.log('Claude decision:', analysis.decision, '|', analysis.reasoning);
    res.json({ success: true, analysis });

  } catch (err) {
    console.error('Error:', err.message);
    const logEntry = {
      id: Date.now(),
      timestamp,
      alert: alertData,
      analysis: { decision: 'ERROR', reasoning: err.message, lot_size: 0.01 }
    };
    alertLog.unshift(logEntry);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /alerts — Dashboard fetches this
app.get('/alerts', (req, res) => {
  res.json(alertLog);
});

// POST /test — Manual test trigger
app.post('/test', async (req, res) => {
  const testAlert = {
    pair: 'XAUUSD',
    action: 'BUY',
    price: '3320.50',
    timeframe: 'M15',
    rsi: '42',
    ma_trend: 'Bullish',
    bos: 'Yes',
    order_block: 'Yes',
    key_level: 'Yes',
    notes: 'Test alert from dashboard'
  };

  try {
    const analysis = await analyzeWithClaude(testAlert);
    const logEntry = { id: Date.now(), timestamp: new Date().toISOString(), alert: testAlert, analysis };
    alertLog.unshift(logEntry);
    if (alertLog.length > 50) alertLog.pop();
    res.json({ success: true, analysis });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`Dashboard:   http://localhost:${PORT}`);
});
