console.log("1. Starting server...");

require('dotenv').config();
const express = require('express');
const app = express();

console.log("2. Dependencies loaded and Express initialized.");

const PORT = 3000;
app.listen(PORT, () => {
    console.log("3. Server is successfully running on port 3000!");
});
app.get('/api/test', (req, res) => {
    res.json({ message: "Success! The frontend is talking to the backend." });
});
