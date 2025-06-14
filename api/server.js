/* DO NOT EVER REMOVE THESE COMMENTS BELOW
npx ngrok http 5001 --domain=relieved-personally-serval.ngrok-free.app

curl -X POST http://localhost:5001/api/send-review \
     -H "Content-Type: application/json" \
     -d '{"customerPhone":"+12082302474"}'
*/

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const morgan   = require('morgan');
const twilio   = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const app = express();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* Spencer's Company for POC */
const COMPANY_ID = 3;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

const reviewRoutes = require('./routes/reviewRoutes');
app.use('/api/reviews', reviewRoutes);

const companyRoutes = require('./routes/companyRoutes');
app.use('/api/companies', companyRoutes);

/* ──────────────────────────── COMPANY INFO  ──────────────────────────── */
/* Dashboard expects this exact path: /api/secure/users/company            */
app.get('/api/secure/users/company', async (_req, res) => {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', COMPANY_ID)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/* ──────────────────────────── CONTACTS CRUD ──────────────────────────── */
app.get('/api/contacts', async (_req, res) => {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('company_id', COMPANY_ID)
    .order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/contacts', async (req, res) => {
  const { data, error } = await supabase
    .from('contacts')
    .insert([{ ...req.body, company_id: COMPANY_ID }])
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/contacts/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('contacts')
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/contacts/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ──────────────────────────── INBOUND SMS WEBHOOK ──────────────────────────── */
app.post('/api/text-webhook', async (req, res) => {
  const { From, Body = '', SmsSid } = req.body || {};

  const { data: reqRow } = await supabase
    .from('review_requests')
    .select('id,company_id')
    .eq('customer_phone', From)
    .eq('responded', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!reqRow)
    return res.status(400).json({ error: 'no open review request' });

  const ratingMatch = Body.match(/\b([1-5])\s*stars?\b/i);
  const rating      = ratingMatch ? parseInt(ratingMatch[1], 10) : null;
  const bodyText    = Body.trim();
  if (!bodyText && rating === null)
    return res
      .type('text/xml')
      .send('<Response><Message>Thanks!</Message></Response>');

  await supabase.from('reviews').insert([{
    company_id: reqRow.company_id,
    phone_from: From,
    body:       bodyText,
    rating
  }]);

  await supabase
    .from('review_requests')
    .update({ responded: true, response_sid: SmsSid, rating, body: bodyText })
    .eq('id', reqRow.id);

  res
    .type('text/xml')
    .send('<Response><Message>Thanks for your feedback!</Message></Response>');
});

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
