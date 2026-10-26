const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI;

// 15分枠と、個別の整理券（tickets）を持つスキーマ
const slotSchema = new mongoose.Schema({
  time: String,
  maxTickets: { type: Number, default: 20 }, 
  issued: { type: Number, default: 0 },
  tickets: [{
    number: Number,
    isCalled: { type: Boolean, default: false }
  }]
});
const Slot = mongoose.model('Slot', slotSchema);

// DBが空の場合に枠を作る関数
async function initSlots() {
  const count = await Slot.countDocuments();
  if (count === 0) {
    const defaultSlots = [
      { time: '10:00', maxTickets: 20 },
      { time: '10:15', maxTickets: 20 },
      { time: '10:30', maxTickets: 20 },
      { time: '10:45', maxTickets: 20 },
      { time: '11:00', maxTickets: 20 },
      { time: '11:15', maxTickets: 20 },
      { time: '11:30', maxTickets: 20 },
      { time: '11:45', maxTickets: 20 },
      { time: '12:00', maxTickets: 20 }
    ];
    await Slot.insertMany(defaultSlots);
    console.log('15分刻みの初期データを作成しました');
  }
}

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected');
    initSlots();
  })
  .catch(err => console.log('MongoDB Connection Error:', err));

// 全データを取得
app.get('/api/slots', async (req, res) => {
  const slots = await Slot.find().sort({ time: 1 });
  res.json(slots);
});

// 整理券を発行
app.post('/api/issue', async (req, res) => {
  const { time } = req.body;
  const slot = await Slot.findOne({ time });

  if (!slot) return res.status(404).json({ error: '時間枠が見つかりません' });
  if (slot.issued >= slot.maxTickets) return res.status(400).json({ error: '定員に達しました' });

  slot.issued += 1;
  slot.tickets.push({ number: slot.issued, isCalled: false });
  await slot.save();

  res.json({ success: true, ticketNumber: slot.issued, time: slot.time });
});

// 個別の番号の「呼び出し済み」を切り替える
app.post('/api/toggle-call', async (req, res) => {
  const { time, ticketNumber } = req.body;
  const slot = await Slot.findOne({ time });

  if (slot) {
    const ticket = slot.tickets.find(t => t.number === ticketNumber);
    if (ticket) {
      ticket.isCalled = !ticket.isCalled;
      await slot.save();
    }
  }
  res.json({ success: true });
});

// 初期化（全消去して作り直す）
app.post('/api/hard-reset', async (req, res) => {
  await Slot.deleteMany({});
  await initSlots();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});