const express = require('express');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI;

const slotSchema = new mongoose.Schema({
  day: String,
  time: String,
  maxTickets: { type: Number, default: 20 },
  issued: { type: Number, default: 0 },
  called: { type: Number, default: 0 }
});
const Slot = mongoose.model('Slot', slotSchema);

async function initSlots() {
  const count = await Slot.countDocuments();
  if (count === 0) {
    const defaultSlots = [];

    // Day 1 (13:00 〜 15:30)
    const day1Times = ['13:00', '13:15', '13:30', '13:45', '14:00', '14:15', '14:30', '14:45', '15:00', '15:15', '15:30'];
    day1Times.forEach(t => defaultSlots.push({ day: 'Day 1', time: t, maxTickets: 20 }));

    // Day 2 (09:00 〜 11:00)
    const day2Times = ['09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30', '10:45', '11:00'];
    day2Times.forEach(t => defaultSlots.push({ day: 'Day 2', time: t, maxTickets: 20 }));

    await Slot.insertMany(defaultSlots);
    console.log('SYSTEM: DATABASE INITIALIZED');
  }
}

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB Connected');
    initSlots();
  })
  .catch(err => console.log('MongoDB Connection Error:', err));

app.get('/api/slots', async (req, res) => {
  const slots = await Slot.find().sort({ day: 1, time: 1 });
  res.json(slots);
});

app.post('/api/update-count', async (req, res) => {
  const { day, time, type, change } = req.body;
  const slot = await Slot.findOne({ day, time });

  if (!slot) return res.status(404).json({ error: 'Not found' });

  if (type === 'issued') {
    // 0〜20（maxTickets）の間に制限する
    slot.issued = Math.max(0, Math.min(slot.maxTickets, slot.issued + change));
    // もし発券数を減らして呼出数より小さくなった場合、呼出数も合わせる
    if (slot.called > slot.issued) slot.called = slot.issued;
  } else if (type === 'called') {
    // 0〜発券数の間に制限する
    slot.called = Math.max(0, Math.min(slot.issued, slot.called + change));
  }

  await slot.save();
  res.json({ success: true, issued: slot.issued, called: slot.called });
});

app.post('/api/hard-reset', async (req, res) => {
  await Slot.deleteMany({});
  await initSlots();
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});