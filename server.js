const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// the 2D version was retired; keep old links working
app.get(['/classic', '/classic/*splat'], (req, res) => res.redirect(301, '/'));

app.listen(PORT, () => {
  console.log(`Pole Position running on port ${PORT}`);
});
